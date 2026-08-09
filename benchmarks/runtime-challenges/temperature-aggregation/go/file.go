package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
)

const maxWorkers = 32

type byteRange struct {
	start int64
	end   int64
}

type aggregateResult struct {
	aggregates map[string]*aggregate
	err        error
}

func aggregateFile(path string, workers int) (map[string]*aggregate, error) {
	if workers < 1 || workers > maxWorkers {
		return nil, fmt.Errorf("workers must be between 1 and %d", maxWorkers)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if workers == 1 || info.Size() == 0 {
		return aggregateReader(file)
	}

	ranges, err := newlineAlignedRanges(file, info.Size(), workers)
	if err != nil {
		return nil, err
	}
	results := make(chan aggregateResult, len(ranges))
	for _, currentRange := range ranges {
		currentRange := currentRange
		go func() {
			reader := io.NewSectionReader(file, currentRange.start, currentRange.end-currentRange.start)
			aggregates, parseErr := aggregateReader(reader)
			results <- aggregateResult{aggregates: aggregates, err: parseErr}
		}()
	}

	merged := make(map[string]*aggregate)
	for range ranges {
		result := <-results
		if result.err != nil {
			return nil, result.err
		}
		mergeAggregates(merged, result.aggregates)
	}
	return merged, nil
}

func newlineAlignedRanges(file *os.File, size int64, workers int) ([]byteRange, error) {
	boundaries := make([]int64, workers+1)
	boundaries[workers] = size
	probe := make([]byte, 128*1024)
	for worker := 1; worker < workers; worker++ {
		target := size * int64(worker) / int64(workers)
		read, err := file.ReadAt(probe, target)
		if err != nil && err != io.EOF {
			return nil, err
		}
		newline := bytes.IndexByte(probe[:read], '\n')
		if newline == -1 {
			boundaries[worker] = size
		} else {
			boundaries[worker] = target + int64(newline) + 1
		}
	}

	ranges := make([]byteRange, 0, workers)
	for worker := 0; worker < workers; worker++ {
		if boundaries[worker] < boundaries[worker+1] {
			ranges = append(ranges, byteRange{start: boundaries[worker], end: boundaries[worker+1]})
		}
	}
	return ranges, nil
}

func mergeAggregates(destination, source map[string]*aggregate) {
	for station, observed := range source {
		current := destination[station]
		if current == nil {
			copy := *observed
			destination[station] = &copy
			continue
		}
		current.count += observed.count
		current.sum += observed.sum
		if observed.min < current.min {
			current.min = observed.min
		}
		if observed.max > current.max {
			current.max = observed.max
		}
	}
}
