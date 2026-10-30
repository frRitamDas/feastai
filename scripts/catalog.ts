import { config } from "dotenv";
import { createCatalogDatabase } from "../lib/server/catalog/postgres";
import { CatalogStore } from "../lib/server/catalog/store";

// Intended for a trusted operator on the application host, not an HTTP API.
// Credentials are passed in the environment, never as command arguments.
config({ path: ".env.local", quiet: true });

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { database, close } = createCatalogDatabase(
    process.env.POSTGRES_URL ?? ""
  );
  const store = new CatalogStore(database, process.env.GRACE_ENCRYPTION_KEY);
  try {
    switch (command) {
      case "add": {
        if (args.length !== 2 || !process.env.GRACE_PROVIDER_CREDENTIAL) {
          throw new Error(
            "add requires provider, label and GRACE_PROVIDER_CREDENTIAL"
          );
        }
        const id = await store.addKey({
          credential: process.env.GRACE_PROVIDER_CREDENTIAL,
          label: args[1],
          provider: args[0],
        });
        console.log(
          `Saved disabled key ${id}; run discovery and explicitly enable permissions.`
        );
        break;
      }
      case "list":
        console.log(JSON.stringify(await store.listKeys(), null, 2));
        break;
      case "models":
        console.log(JSON.stringify(await store.listCatalog(), null, 2));
        break;
      case "discover": {
        if (args.length !== 1) {
          throw new Error("discover requires a key ID");
        }
        const result = await store.discover(args[0]);
        console.log(
          result.status === "discovered"
            ? `Discovered ${result.models.length} model entries; listing does not prove inference access.`
            : `Discovery status: ${result.status}`
        );
        break;
      }
      case "verify":
        if (args.length !== 2) {
          throw new Error("key ID and model ID required");
        }
        console.log(
          (await store.verify(args[0], args[1]))
            ? "Model inference verified."
            : "Inference verification failed."
        );
        break;
      case "enable-key":
      case "disable-key":
        if (args.length !== 1) {
          throw new Error("key ID required");
        }
        await store.setKeyEnabled(args[0], command === "enable-key");
        console.log("Key updated.");
        break;
      case "enable-model":
      case "disable-model":
        if (args.length !== 1) {
          throw new Error("model ID required");
        }
        await store.setModelEnabled(args[0], command === "enable-model");
        console.log("Model updated.");
        break;
      case "permit":
      case "revoke":
        if (args.length !== 2) {
          throw new Error("key ID and model ID required");
        }
        await store.setPermission(args[0], args[1], command === "permit");
        console.log("Permission updated.");
        break;
      case "delete":
        if (args.length !== 1) {
          throw new Error("key ID required");
        }
        await store.deleteKey(args[0]);
        console.log("Key deleted.");
        break;
      default:
        throw new Error(
          "Use add, list, models, discover, verify, enable-key, disable-key, enable-model, disable-model, permit, revoke, or delete"
        );
    }
  } finally {
    await close();
  }
}

main().catch(() => {
  // Database or provider errors can contain connection details; never print them.
  console.error(
    "Catalog operation failed. Check configuration and inputs securely."
  );
  process.exitCode = 1;
});
