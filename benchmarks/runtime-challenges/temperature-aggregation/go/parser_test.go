package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestOfficialContractAndTrailingRow(t *testing.T) {
	input := []byte("Zürich;-0.5\nAbéché;10.0\nA;99.9\nZürich;0.4\nAbéché;10.1\nA;-99.9")
	aggregates, err := aggregateReader(bytes.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	const expected = "{A=-99.9/0.0/99.9, Abéché=10.0/10.1/10.1, Zürich=-0.5/0.0/0.4}"
	if observed := formatOfficialResults(aggregates); observed != expected {
		t.Fatalf("unexpected result\nwant: %s\n got: %s", expected, observed)
	}
}

func TestRejectsInvalidRows(t *testing.T) {
	for _, input := range []string{
		"missing separator\n",
		"station;\n",
		"station;nope\n",
		"station;12\n",
		"station;1.23\n",
		"station;1..2\n",
	} {
		if _, err := aggregateReader(bytes.NewBufferString(input)); err == nil {
			t.Fatalf("expected error for %q", input)
		}
	}
}

func TestAggregateFileMatchesSequentialAcrossBoundaries(t *testing.T) {
	input := append(deterministicRows(20_003), []byte("final-station;-9.9")...)
	path := filepath.Join(t.TempDir(), "measurements.txt")
	if err := os.WriteFile(path, input, 0o600); err != nil {
		t.Fatal(err)
	}
	sequential, err := aggregateFile(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := formatOfficialResults(sequential)
	for _, workers := range []int{2, 4, 8} {
		parallel, parseErr := aggregateFile(path, workers)
		if parseErr != nil {
			t.Fatalf("workers=%d: %v", workers, parseErr)
		}
		if got := formatOfficialResults(parallel); got != want {
			t.Fatalf("workers=%d produced a different result", workers)
		}
	}
}

func TestAggregateFileRejectsUnboundedWorkers(t *testing.T) {
	if _, err := aggregateFile("unused", 0); err == nil {
		t.Fatal("expected zero workers to be rejected")
	}
	if _, err := aggregateFile("unused", maxWorkers+1); err == nil {
		t.Fatal("expected excessive workers to be rejected")
	}
}

func BenchmarkAggregateRows(b *testing.B) {
	input := deterministicRows(800_000)
	b.SetBytes(int64(len(input)))
	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		aggregates, err := aggregateReader(bytes.NewReader(input))
		if err != nil || len(aggregates) != 64 {
			b.Fatalf("invalid aggregate: stations=%d err=%v", len(aggregates), err)
		}
	}
}

func BenchmarkAggregateFile(b *testing.B) {
	input := deterministicRows(800_000)
	path := filepath.Join(b.TempDir(), "measurements.txt")
	if err := os.WriteFile(path, input, 0o600); err != nil {
		b.Fatal(err)
	}
	for _, workers := range []int{1, 2, 4, 8} {
		b.Run(fmt.Sprintf("workers=%d", workers), func(b *testing.B) {
			b.SetBytes(int64(len(input)))
			b.ReportAllocs()
			for iteration := 0; iteration < b.N; iteration++ {
				aggregates, err := aggregateFile(path, workers)
				if err != nil || len(aggregates) != 64 {
					b.Fatalf("invalid aggregate: stations=%d err=%v", len(aggregates), err)
				}
			}
		})
	}
}

func BenchmarkAggregateFileSelected(b *testing.B) {
	const workers = 8
	input := deterministicRows(800_000)
	path := filepath.Join(b.TempDir(), "measurements.txt")
	if err := os.WriteFile(path, input, 0o600); err != nil {
		b.Fatal(err)
	}
	b.SetBytes(int64(len(input)))
	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		aggregates, err := aggregateFile(path, workers)
		if err != nil || len(aggregates) != 64 {
			b.Fatalf("invalid aggregate: stations=%d err=%v", len(aggregates), err)
		}
	}
}

func deterministicRows(rows int) []byte {
	var buffer bytes.Buffer
	buffer.Grow(rows * 17)
	for row := 0; row < rows; row++ {
		station := row % 64
		temperature := ((row*73)+(station*11))%1_999 - 999
		absolute := temperature
		sign := ""
		if absolute < 0 {
			sign = "-"
			absolute = -absolute
		}
		fmt.Fprintf(&buffer, "station-%02d;%s%d.%d\n", station, sign, absolute/10, absolute%10)
	}
	return buffer.Bytes()
}
