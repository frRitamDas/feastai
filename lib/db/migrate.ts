import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    console.log("POSTGRES_URL not defined, skipping migrations");
    process.exit(0);
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log("Running migrations...");

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
// --- GROKBOT SEEDING SCRIPT ---
async function seedGrokBots() {
  const seedSql = `
    create table if not exists "Bot" (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      handle text not null unique,
      description text not null,
      avatar text,
      "systemPrompt" text not null,
      model text default 'llama-3.3-70b-versatile',
      "temperature" numeric default 0.7,
      "isPublic" boolean default true,
      "creatorId" uuid references "User"(id) on delete cascade not null,
      "createdAt" timestamp with time zone default timezone('utc'::text, now()) not null
    );

    alter table "Chat" add column if not exists "botId" uuid references "Bot"(id) on delete set null;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Captain SmartPickShop USA (Orchestrator)', 'captain', 'Master orchestrator, tool manager, money task prioritizer, and execution commander.', '🧭', 'You are Grok Bot (Captain), master coordinator of SmartPickShop USA Holdings, LLC. Maintain strict operation boundaries, enforce $0 verified revenue baseline, oversee box tools, and direct active bot workstreams.', 'deepseek-r1-distill-llama-70b', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'The Mayor (Ledger Keeper)', 'the-mayor', 'Keeper of the master project ledgers, working copy registers, and canon facts.', '📜', 'You are Grok Bot (The Mayor), sole authority writing to the WORKING COPY - MASTER Project Ledger. Append updates only, preserve distinct P-IDs, never invent facts, and maintain PT timestamping.', 'llama-3.3-70b-versatile', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Dr. Finkelstein (Site Smith)', 'dr-finkel', 'Site architecture, 22-site manager, themes, deployment, and infrastructure.', '⚡', 'You are Dr. Finkelstein (Site Smith). Manage the 22 SmartPickShop web properties, audit themes, structure codebases, and maintain hosting blueprints across GitHub, GitLab, and Render.', 'qwen-2.5-coder-32b', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Jack Skellington (Brand Forge)', 'jack-skelly', 'Brand lead, visual style tokens, Steampunk Neon x Voltage Foundry canon.', '🎩', 'You are Jack Skellington (Brand Forge). Oversee the Steampunk Neon brand canon (#D4AF37 brass, #22D3EE cyan, #F472B6 pink). Enforce character rules and asset guidelines without deviation.', 'llama-3.3-70b-versatile', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Sally (Art Foundry)', 'sally', 'Visual designer for 4 gears (Brass, Neon, Riot, Midnight) and mascot turnarounds.', '🎨', 'You are Sally (Art Foundry). Direct image generation, aspect ratios, character design continuity (Beacon cloudy right eye), and visual asset pipelines across all four gears.', 'gemini-2.5-flash', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Oogie Boogie (Sales Forge)', 'oogie', 'Offers, pricing structures, outreach drafting, and sales conversion kits.', '🎲', 'You are Oogie Boogie (Sales Forge). Build high-converting offer copy, value funnels, and draft cold outreach strictly within CAN-SPAM guidelines. Never claim unverified revenue.', 'deepseek-r1-distill-llama-70b', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Zero (Site Overseer)', 'zero', 'SmartPickShop store feature engineer, product descriptions, and storefront copy.', '🐶', 'You are Zero (Site Overseer). Build production-ready storefront copy, character dossier content, and ecommerce features for smartpickshopusa.com.', 'llama-3.3-70b-versatile', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;

    insert into "Bot" (name, handle, description, avatar, "systemPrompt", model, "creatorId")
    select 'Sprock (Gemini Sweeper)', 'sprock', 'Read-only auditor of historical chats, Takeout archives, and NotebookLM.', '🔍', 'You are Sprock. Conduct read-only context sweeps across archives, extract multi-tier summaries, flag action items, and maintain data hygiene.', 'gemini-2.5-flash', id from "User" limit 1
    on conflict (handle) do update set name = excluded.name, description = excluded.description, avatar = excluded.avatar, "systemPrompt" = excluded."systemPrompt", model = excluded.model;
  `;

  try {
    // Uses the existing drizzle/postgres connection inside migrate.ts
    // @ts-ignore
    await db.execute(seedSql);
    console.log('✅ GrokBot table and roster successfully provisioned!');
  } catch (err) {
    console.log('Bot seeding note:', err);
  }
}

// Call the function right after the main migration completes
seedGrokBots().catch(console.error);
-- 3. Superadmin Auto-Promotion for anastaysiagalavox@gmail.com
    -- Immediate promotion if account already exists
    insert into profiles (id, email, tier, is_admin, created_at)
    select id, email, 'heavy', true, now()
    from "User"
    where email = 'anastaysiagalavox@gmail.com'
    on conflict (id) do update set tier = 'heavy', is_admin = true;

    update profiles 
    set tier = 'heavy', is_admin = true 
    where email = 'anastaysiagalavox@gmail.com';

    -- Trigger: Automatically promotes anastaysiagalavox@gmail.com if registered later
    create or replace function promote_superadmin()
    returns trigger as $$
    begin
      if lower(new.email) = 'anastaysiagalavox@gmail.com' then
        insert into profiles (id, email, tier, is_admin, created_at)
        values (new.id, new.email, 'heavy', true, now())
        on conflict (id) do update set tier = 'heavy', is_admin = true;
      end if;
      return new;
    end;
    $$ language plpgsql;

    drop trigger if exists trg_promote_superadmin on "User";
    create trigger trg_promote_superadmin
    after insert or update on "User"
    for each row execute function promote_superadmin();
