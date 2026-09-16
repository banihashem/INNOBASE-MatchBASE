// Trusted data boundary. This module never loads candidate code.
export const MAX_OBSERVATION_BYTES = 8_192;
export function readCandidateObservations(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text) > MAX_OBSERVATION_BYTES
  )
    throw new Error("Candidate observations exceed the bounded data contract.");
  const value = JSON.parse(text);
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "observations,version" ||
    value.version !== "candidate-observations.v1" ||
    !Array.isArray(value.observations) ||
    value.observations.length !== 6
  )
    throw new Error("Candidate observations do not match the data contract.");
  for (const [index, item] of value.observations.entries()) {
    if (
      !item ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(",") !== "case_id,value" ||
      item.case_id !== `case-${index}` ||
      !Number.isSafeInteger(item.value)
    )
      throw new Error(
        "Candidate observation is missing, duplicated or malformed.",
      );
  }
  return value;
}

export function gradeSyntheticObservations(text) {
  const result = readCandidateObservations(text);
  // Fixed development oracle, not a held-out benchmark or model qualification.
  const expected = [0, 1, 3, 5, 12, 24];
  return result.observations.every(
    (item, index) => item.value === expected[index],
  );
}
