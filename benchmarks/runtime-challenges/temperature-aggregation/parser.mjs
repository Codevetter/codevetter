export function aggregateTemperatures(text) {
  const aggregates = new Map();
  let cursor = 0;
  while (cursor < text.length) {
    const separator = text.indexOf(';', cursor);
    if (separator === -1) break;
    const station = text.slice(cursor, separator);
    cursor = separator + 1;

    let sign = 1;
    if (text.charCodeAt(cursor) === 45) {
      sign = -1;
      cursor += 1;
    }
    let temperature = 0;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      cursor += 1;
      if (code === 10) break;
      if (code !== 46) temperature = temperature * 10 + code - 48;
    }
    temperature *= sign;

    const aggregate = aggregates.get(station);
    if (aggregate) {
      aggregate.count += 1;
      aggregate.sum += temperature;
      if (temperature < aggregate.min) aggregate.min = temperature;
      if (temperature > aggregate.max) aggregate.max = temperature;
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

export function formatOfficialResults(aggregates) {
  const entries = [...aggregates].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries
    .map(([station, aggregate]) => {
      const mean = Math.round(aggregate.sum / aggregate.count);
      return `${station}=${formatTenths(aggregate.min)}/${formatTenths(mean)}/${formatTenths(aggregate.max)}`;
    })
    .join(', ')}}`;
}

function formatTenths(value) {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized < 0 ? '-' : '';
  const absolute = Math.abs(normalized);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}`;
}
