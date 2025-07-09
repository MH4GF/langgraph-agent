-- Create design_sessions table
CREATE TABLE IF NOT EXISTS "public"."design_sessions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Add RLS policies
ALTER TABLE "public"."design_sessions" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for anon users
CREATE POLICY "Allow all operations for anon users" ON "public"."design_sessions"
FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON TABLE "public"."design_sessions" TO "anon";
GRANT ALL ON TABLE "public"."design_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."design_sessions" TO "service_role";

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_design_sessions_updated_at
    BEFORE UPDATE ON design_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();