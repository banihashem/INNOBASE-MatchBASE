const mode = process.argv[2];
if (mode === "success") {
  process.stderr.write(
    "Encryption: Google-managed key\nRepository Size: 42 MB\n",
  );
  process.stdout.write('{"name":"closed"}\n');
  process.exit(0);
}
process.stdout.write('{"name":"must-not-be-used"}\n');
process.stderr.write("permission denied:" + "x".repeat(6000));
process.exit(7);
