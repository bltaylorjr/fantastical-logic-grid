#!/bin/bash
# Creates the free Oracle build server (flg-build: Ampere A1, 2 cores, 12 GB,
# Ubuntu 24.04, 100 GB disk) in Ashburn, trying each availability domain once.
# With SMALLER=1 it also tries 1 core/6 GB (still free).
# Oracle's free Arm servers are often sold out, so .github/workflows/
# oracle-create-server.yml runs this every few minutes until one is created.
#
# Needs a working `oci` command line (~/.oci/config). Prints one of:
#   EXISTS   flg-build already exists (nothing to do)
#   CREATED  flg-build was created just now
#   FULL     every zone is out of capacity (try again later)
# and writes result=<that word> to $GITHUB_OUTPUT when it is set.
# Any other problem (sign-in, settings) exits with an error.
set -uo pipefail
NAME=flg-build
HERE=$(cd "$(dirname "$0")" && pwd)
# Everything lives in the root compartment, whose id is the tenancy id.
C=${OCI_TENANCY:-$(grep '^tenancy=' ~/.oci/config | cut -d= -f2)}
out() { echo "$1 $2"; [ -n "${GITHUB_OUTPUT:-}" ] && echo "result=$1" >> "$GITHUB_OUTPUT"; return 0; }

existing=$(oci compute instance list -c "$C" --display-name "$NAME" --query 'data[?!contains(`["TERMINATED","TERMINATING"]`, "lifecycle-state")].id | [0]' --raw-output) || { echo "Could not list instances (check the Oracle sign-in settings)."; exit 1; }
if [ -n "$existing" ] && [ "$existing" != null ]; then out EXISTS "$NAME is already there: $existing"; exit 0; fi

VCN=$(oci network vcn list -c "$C" --display-name flg-network --query 'data[0].id' --raw-output)
SN=$(oci network subnet list -c "$C" --vcn-id "$VCN" --query "data[?contains(\"display-name\", 'public')].id | [0]" --raw-output)
IMG=$(oci compute image list -c "$C" --operating-system 'Canonical Ubuntu' --operating-system-version 24.04 --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output)
for v in VCN SN IMG; do [ -n "${!v}" ] && [ "${!v}" != null ] || { echo "Could not find $v (network flg-network, its public subnet, or the Ubuntu 24.04 Arm image)."; exit 1; }; done

# Startup script: the server sets itself up (scripts/runner/oracle-cloud-init.sh).
# The GitHub runner token and Cloudflare tunnel are added afterwards over SSH.
printf '#!/bin/bash\ncurl -fsSL https://raw.githubusercontent.com/bltaylorjr/fantastical-logic-grid/main/scripts/runner/oracle-cloud-init.sh -o /root/setup.sh && bash /root/setup.sh\n' > /tmp/flg-init.sh

# Sizes to try, largest first. Oracle's Always Free Arm allowance is 2 cores
# and 12 GB (1,500 OCPU hours and 9,000 GB hours a month; it was 4 and 24
# until mid 2026), so anything bigger would be charged. SMALLER=1 adds
# 1 core/6 GB as a last resort.
SIZES="2:12"
[ "${SMALLER:-}" = 1 ] && SIZES="2:12 1:6"
ADS=$(oci iam availability-domain list -c "$C" --query 'data[].name' --raw-output | tr -d '[]," ')
for size in $SIZES; do
  cpu=${size%%:*}; mem=${size##*:}
  for AD in $ADS; do
    res=$(oci compute instance launch --no-retry -c "$C" --availability-domain "$AD" --display-name "$NAME" \
      --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$cpu,\"memoryInGBs\":$mem}" --image-id "$IMG" --subnet-id "$SN" \
      --assign-public-ip true --boot-volume-size-in-gbs 100 --ssh-authorized-keys-file "$HERE/flg-build.pub" \
      --user-data-file /tmp/flg-init.sh 2>&1)
    if echo "$res" | grep -q '"lifecycle-state"'; then out CREATED "$NAME in $AD with $cpu cores and $mem GB"; exit 0; fi
    msg=$(echo "$res" | grep -o '"message": "[^"]*' | head -1 | cut -c13-)
    echo "$AD, $cpu cores: ${msg:-$(echo "$res" | tail -c 300)}"
    # Anything but a capacity answer (or Oracle asking us to slow down) is a real problem.
    echo "$msg" | grep -qi 'capacity\|too many requests' || { echo "Stopping: unexpected answer from Oracle."; exit 1; }
  done
done
out FULL "every zone is out of capacity right now"
