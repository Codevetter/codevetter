package main

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"sort"
	"strings"
)

type aggregate struct {
	count int64
	sum   int64
	min   int
	max   int
}

func aggregateReader(reader io.Reader) (map[string]*aggregate, error) {
	aggregates := make(map[string]*aggregate)
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 128*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		separator := bytes.IndexByte(line, ';')
		if separator <= 0 || separator == len(line)-1 {
			return nil, fmt.Errorf("invalid row")
		}
		temperature, ok := parseTemperature(line[separator+1:])
		if !ok {
			return nil, fmt.Errorf("invalid temperature")
		}
		stationBytes := line[:separator]
		if current := aggregates[string(stationBytes)]; current != nil {
			current.count++
			current.sum += int64(temperature)
			if temperature < current.min {
				current.min = temperature
			}
			if temperature > current.max {
				current.max = temperature
			}
		} else {
			aggregates[string(stationBytes)] = &aggregate{
				count: 1,
				sum:   int64(temperature),
				min:   temperature,
				max:   temperature,
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return aggregates, nil
}

func parseTemperature(value []byte) (int, bool) {
	sign := 1
	cursor := 0
	if value[0] == '-' {
		sign = -1
		cursor++
	}
	remaining := value[cursor:]
	if len(remaining) == 3 && digit(remaining[0]) && remaining[1] == '.' && digit(remaining[2]) {
		return sign * (int(remaining[0]-'0')*10 + int(remaining[2]-'0')), true
	}
	if len(remaining) == 4 && digit(remaining[0]) && digit(remaining[1]) && remaining[2] == '.' && digit(remaining[3]) {
		return sign * (int(remaining[0]-'0')*100 + int(remaining[1]-'0')*10 + int(remaining[3]-'0')), true
	}
	return 0, false
}

func digit(value byte) bool {
	return value >= '0' && value <= '9'
}

func updateAggregate(aggregates map[string]*aggregate, station string, temperature int) {
	if current := aggregates[station]; current != nil {
		current.count++
		current.sum += int64(temperature)
		if temperature < current.min {
			current.min = temperature
		}
		if temperature > current.max {
			current.max = temperature
		}
		return
	}
	aggregates[station] = &aggregate{count: 1, sum: int64(temperature), min: temperature, max: temperature}
}

func formatOfficialResults(aggregates map[string]*aggregate) string {
	stations := make([]string, 0, len(aggregates))
	for station := range aggregates {
		stations = append(stations, station)
	}
	sort.Strings(stations)
	parts := make([]string, 0, len(stations))
	for _, station := range stations {
		value := aggregates[station]
		mean := roundTowardPositive(value.sum, value.count)
		parts = append(parts, fmt.Sprintf("%s=%s/%s/%s", station, formatTenths(value.min), formatTenths(mean), formatTenths(value.max)))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func roundTowardPositive(sum, count int64) int {
	numerator := 2*sum + count
	denominator := 2 * count
	quotient := numerator / denominator
	if numerator < 0 && numerator%denominator != 0 {
		quotient--
	}
	return int(quotient)
}

func formatTenths(value int) string {
	if value == 0 {
		return "0.0"
	}
	sign := ""
	if value < 0 {
		sign = "-"
		value = -value
	}
	return fmt.Sprintf("%s%d.%d", sign, value/10, value%10)
}
