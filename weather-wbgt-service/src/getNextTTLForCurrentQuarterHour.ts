export default function getNextTTLForCurrentQuarterHour(
  bufferSecs: number,
): number {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const totalSeconds = minutes * 60 + seconds;
  const nextQuarterHourInSeconds =
    Math.ceil(totalSeconds / (15 * 60)) * (15 * 60);
  const ttl = nextQuarterHourInSeconds - totalSeconds + bufferSecs;
  return ttl;
}
