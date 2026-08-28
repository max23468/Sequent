import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const writeExecutable = (path: string, content: string) => {
  writeFileSync(path, content, { mode: 0o755 });
  chmodSync(path, 0o755);
};

test("l'accesso VPS usa soltanto la chiave cifrata in un agente effimero", () => {
  const root = mkdtempSync(join(tmpdir(), "sequent-ssh-test-"));
  const bin = join(root, "bin");
  const config = join(root, "local-vps.env");
  const encryptedKey = join(root, "access.key.age");
  const identity = join(root, "age-identity.txt");
  const log = join(root, "calls.log");

  try {
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(encryptedKey, "blob-cifrato\n");
    writeFileSync(identity, "identita-age\n", { mode: 0o600 });
    writeFileSync(
      config,
      [
        "SEQUENT_SSH_HOST=vps.example.invalid",
        "SEQUENT_SSH_USER=operator",
        `SEQUENT_SSH_KEY_AGE='${encryptedKey}'`,
        `SEQUENT_AGE_IDENTITY='${identity}'`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    writeExecutable(join(bin, "age"), "#!/bin/sh\nprintf 'private-key-stream\\n'\n");
    writeExecutable(
      join(bin, "ssh-agent"),
      `#!/bin/sh
if [ "\${1:-}" = "-k" ]; then
  printf 'agent-killed\\n' >>"$SEQUENT_TEST_LOG"
  exit 0
fi
printf "SSH_AUTH_SOCK='%s'; export SSH_AUTH_SOCK;\\n" "$SSH_AUTH_SOCK"
printf "SSH_AGENT_PID='12345'; export SSH_AGENT_PID;\\n"
`,
    );
    writeExecutable(
      join(bin, "ssh-add"),
      `#!/bin/sh
if [ "\${1:-}" = "-" ]; then
  input=$(cat)
  printf 'loaded:%s\\n' "$input" >>"$SEQUENT_TEST_LOG"
  exit 0
fi
if [ "\${1:-}" = "-L" ]; then
  printf 'ssh-ed25519 AAAATEST sequent-test\\n'
  exit 0
fi
exit 2
`,
    );
    writeExecutable(
      join(bin, "ssh"),
      `#!/bin/sh
identity_file=
previous=
for argument in "$@"; do
  if [ "$previous" = "-i" ]; then identity_file=$argument; fi
  previous=$argument
  printf 'ssh-arg:%s\\n' "$argument" >>"$SEQUENT_TEST_LOG"
done
test -f "$identity_file"
grep -q '^ssh-ed25519 AAAATEST ' "$identity_file"
`,
    );

    execFileSync("bash", ["scripts/local/ssh-vps.sh", "printf", "ok"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SEQUENT_LOCAL_VPS_CONFIG: config,
        SEQUENT_TEST_LOG: log,
      },
    });

    const calls = readFileSync(log, "utf8");
    assert.match(calls, /loaded:private-key-stream/);
    assert.match(calls, /ssh-arg:BatchMode=yes/);
    assert.match(calls, /ssh-arg:IdentitiesOnly=yes/);
    assert.match(calls, /ssh-arg:IdentityAgent=/);
    assert.match(calls, /ssh-arg:operator@vps\.example\.invalid/);
    assert.match(calls, /ssh-arg:printf\nssh-arg:ok/);
    assert.match(calls, /agent-killed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lo script non contiene target o percorsi amministrativi reali", () => {
  const script = readFileSync("scripts/local/ssh-vps.sh", "utf8");

  assert.doesNotMatch(script, /(?:root|ubuntu|admin)@[a-z0-9.-]+/i);
  assert.doesNotMatch(script, /fatture|Hub-Fatture|\.key\b/);
  assert.match(script, /SEQUENT_LOCAL_VPS_CONFIG/);
  assert.match(script, /age --decrypt[^\n]*\n\s*\| ssh-add -/);
  assert.match(script, /IdentitiesOnly=yes/);
  assert.match(script, /trap cleanup EXIT HUP INT TERM/);
});
