import { auth } from "@/app/(auth)/auth";
import {
  chatModels,
  getAllGatewayModels,
  getCapabilities,
  isDemo,
} from "@/lib/ai/models";
import { getEffectiveEntitlement } from "@/lib/db/queries";
import { getRuntimeCatalog } from "@/lib/server/catalog/runtime";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const curatedCapabilities = await getCapabilities();

  try {
    const catalog = getRuntimeCatalog();
    if (catalog) {
      const session = await auth();
      if (!session?.user?.id) {
        return Response.json(
          { error: "Sign in required" },
          { headers: { "Cache-Control": "no-store" }, status: 401 }
        );
      }
      const entitlement = await getEffectiveEntitlement(session.user.id);
      if (!entitlement) {
        return Response.json(
          { error: "Account unavailable" },
          { headers: { "Cache-Control": "no-store" }, status: 403 }
        );
      }
      const [available, routes] = await Promise.all([
        catalog.listPublicModels(entitlement.plan),
        catalog.listPublicRoutes(entitlement.plan),
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
      for (const model of available) {
        capabilities[`grace/${model.id}`] = {
          reasoning: false,
          tools: false,
          vision: model.supportsVision === true,
        };
      }
      for (const route of routes) {
        capabilities[`auto/${route.id}`] = {
          reasoning: false,
          tools: false,
          vision: route.supportsVision === true,
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
