-- The application uses Auth.js and server-side Postgres, not Supabase client
-- sessions. Without policies, Supabase anonymous and authenticated Data API
-- roles cannot read or write these tables. The application connection must be
-- the table owner or an explicitly trusted role with BYPASSRLS.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Chat" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Message_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Vote_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Suggestion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Stream" ENABLE ROW LEVEL SECURITY;
