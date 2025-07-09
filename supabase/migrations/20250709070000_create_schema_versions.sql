-- Create schema_versions table
CREATE TABLE IF NOT EXISTS "public"."schema_versions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "design_session_id" UUID NOT NULL REFERENCES "public"."design_sessions"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "migration" JSONB NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE("design_session_id", "version")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_schema_versions_design_session_id" ON "public"."schema_versions"("design_session_id");
CREATE INDEX IF NOT EXISTS "idx_schema_versions_version" ON "public"."schema_versions"("version");
CREATE INDEX IF NOT EXISTS "idx_schema_versions_migration" ON "public"."schema_versions" USING GIN("migration");

-- Add RLS policies
ALTER TABLE "public"."schema_versions" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for anon users
CREATE POLICY "Allow all operations for anon users" ON "public"."schema_versions"
FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON TABLE "public"."schema_versions" TO "anon";
GRANT ALL ON TABLE "public"."schema_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_versions" TO "service_role";

-- Create updated_at trigger
CREATE TRIGGER update_schema_versions_updated_at
    BEFORE UPDATE ON schema_versions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();