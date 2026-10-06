export function onlineDiagnostic(event, fields = {}, level = 'info') {
  const record = {
    service: 'garrison-online',
    timestamp: new Date().toISOString(),
    event,
    ...fields
  };
  const write = typeof console[level] === 'function' ? console[level] : console.info;
  write.call(console, JSON.stringify(record));
}

export function shortId(value) {
  if (typeof value !== 'string' || !value) return null;
  return value.slice(-6);
}

export function roomTag(value) {
  if (typeof value !== 'string' || !value) return null;
  return `…${value.slice(-2)}`;
}

export function signalKindSummary(type, data) {
  if (type !== 'signal.ice') return {};
  if (data == null) return {candidateEnd: true};
  const candidate = typeof data.candidate === 'string' ? data.candidate : '';
  const candidateType = data.type || candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/i)?.[1]?.toLowerCase() || null;
  const protocol = data.protocol || candidate.match(/^candidate:\S+\s+\d+\s+(udp|tcp)\s/i)?.[1]?.toLowerCase() || null;
  return {candidateType, protocol};
}
