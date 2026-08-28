import {
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  resetOwnerCredentials,
} from "../../src/lib/server/auth.ts";
import { getDataDirectory } from "../../src/lib/server/config.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("PASSWORD_STDIN_REQUIRED");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/[\r\n]+$/, "");
}

const username = argument("--username");
if (!username || normalizeUsername(username).length === 0 || username.length > 64)
  throw new Error("USERNAME_INVALID");
const password = await readPassword();
if (password.length < MIN_PASSWORD_LENGTH || password.length > 128)
  throw new Error("PASSWORD_INVALID");

const dataDirectory = getDataDirectory();
try {
  await resetOwnerCredentials(openDatabase(dataDirectory), username, password);
  console.log("Credenziali proprietario aggiornate e sessioni revocate.");
} finally {
  closeDatabase(dataDirectory);
}
