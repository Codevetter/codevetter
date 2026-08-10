package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	workers := flag.Int("workers", 1, "bounded parser worker count")
	flag.Parse()
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: go-1brc [-workers N] measurements.txt")
		os.Exit(2)
	}
	aggregates, err := aggregateFile(flag.Arg(0), *workers)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(formatOfficialResults(aggregates))
}
