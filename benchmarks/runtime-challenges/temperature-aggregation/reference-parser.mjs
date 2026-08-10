export function aggregateTemperaturesReference(text) {
  const aggregates = new Map();
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const [station, rawTemperature] = line.split(';');
    const temperature = Math.round(Number(rawTemperature) * 10);
    const aggregate = aggregates.get(station);
    if (aggregate) {
      aggregate.count += 1;
      aggregate.sum += temperature;
      aggregate.min = Math.min(aggregate.min, temperature);
      aggregate.max = Math.max(aggregate.max, temperature);
    } else {
      aggregates.set(station, {
        count: 1,
        sum: temperature,
        min: temperature,
        max: temperature,
      });
    }
  }
  return aggregates;
}
