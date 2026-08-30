const environment = process.argv[2];
if (
  process.argv.length !== 3 ||
  !["staging", "production"].includes(environment)
) {
  throw new Error(
    "A production image requires an explicit staging or production deployment environment.",
  );
}
