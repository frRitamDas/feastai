import {
  chatModels,
  getAllGatewayModels,
  getCapabilities,
  isDemo,
} from "@/lib/ai/models";
import { getRuntimeCatalog } from "@/lib/server/catalog/runtime";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const curatedCapabilities = await getCapabilities();

  try {
    const catalog = getRuntimeCatalog();
    if (catalog) {
      const [available, routes] = await Promise.all([
        catalog.listPublicModels(),
        catalog.listPublicRoutes(),
      ]);
      const shared = available.map((m) => ({
        description: "Shared provider model",
        id: `grace/${m.id}`,
        name: String(m.name),
        provider: String(m.provider),
      }));
      const automatic = routes.map((route) => ({
        description: "Administrator-configured automatic route",
        id: `auto/${route.id}`,
        name: String(route.name),
        provider: "Grace AI",
      }));
      const capabilities = { ...curatedCapabilities };
      for (const model of [...shared, ...automatic]) {
        capabilities[model.id] = {
          reasoning: false,
          tools: false,
          vision: false,
        };
      }
      return Response.json(
        {
          capabilities,
          eligibleModelIds: [...shared, ...automatic].map((m) => m.id),
          models: [...chatModels, ...shared, ...automatic],
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
  } catch {
    return Response.json(
      { error: "Model catalog unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json(curatedCapabilities, { headers });
}
