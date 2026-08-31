#!/bin/sh
set -eu

case "${MATCHBASE_DEPLOYMENT_ENVIRONMENT:-}" in
  staging|production) ;;
  *) echo "Invalid or missing MATCHBASE_DEPLOYMENT_ENVIRONMENT." >&2; exit 78 ;;
esac
if [ "${MATCHBASE_ENVIRONMENT:-}" != "production" ]; then
  echo "Runtime image requires MATCHBASE_ENVIRONMENT=production." >&2
  exit 78
fi
case "${MATCHBASE_DEPLOYMENT_ID:-}" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) echo "Runtime image requires an immutable deployment digest identity." >&2; exit 78 ;;
esac
case "${MATCHBASE_DEPLOYMENT_ID#sha256:}" in
  *[!0-9a-f]*) echo "Runtime image deployment digest is not lowercase hexadecimal." >&2; exit 78 ;;
esac
if [ "${MATCHBASE_IMAGE_DIGEST:-}" != "${MATCHBASE_DEPLOYMENT_ID}" ]; then
  echo "Runtime image digest identity mismatch." >&2
  exit 78
fi
case "${MATCHBASE_RUNTIME_KIND:-}" in
  web|worker) ;;
  *) echo "Runtime image kind must be web or worker." >&2; exit 78 ;;
esac
case "${MATCHBASE_ROUTE_POLICY_SHA256:-}" in
  ????????????????????????????????????????????????????????????????) ;;
  *) echo "Runtime requires a route-policy SHA-256 identity." >&2; exit 78 ;;
esac
case "${MATCHBASE_ROUTE_POLICY_SHA256}" in
  *[!0-9a-f]*) echo "Runtime route-policy identity is not lowercase hexadecimal." >&2; exit 78 ;;
esac
route_policy_path=/app/config/slice3/research-route-policy.v1.json
if [ ! -f "$route_policy_path" ]; then
  echo "Runtime governed route policy is missing." >&2
  exit 78
fi
actual_route_policy_sha256=$(sha256sum "$route_policy_path" | cut -d ' ' -f 1)
if [ "$actual_route_policy_sha256" != "$MATCHBASE_ROUTE_POLICY_SHA256" ]; then
  echo "Runtime governed route-policy bytes do not match the deployment identity." >&2
  exit 78
fi
policy_identity=$(node -e '
  const fs=require("node:fs");
  const policy=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(policy.liveActivation!=="enabled" || !Array.isArray(policy.routes) || policy.routes.length<1 || policy.routes.some((route)=>route.enabled!==true || route.liveQualified!==true)) process.exit(78);
  process.stdout.write(`${policy.environment}\n${policy.policyVersion}`);
' "$route_policy_path")
policy_environment=$(printf '%s\n' "$policy_identity" | sed -n '1p')
policy_version=$(printf '%s\n' "$policy_identity" | sed -n '2p')
if [ "$policy_environment" != "$MATCHBASE_DEPLOYMENT_ENVIRONMENT" ] || [ "$policy_version" != "${MATCHBASE_ROUTE_POLICY_VERSION:-}" ]; then
  echo "Runtime route policy environment or version does not match the deployment identity." >&2
  exit 78
fi
exec "$@"
