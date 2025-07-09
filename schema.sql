

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."checkpoint_blobs" (
    "thread_id" "text" NOT NULL,
    "checkpoint_ns" "text" DEFAULT ''::"text" NOT NULL,
    "channel" "text" NOT NULL,
    "version" "text" NOT NULL,
    "type" "text" NOT NULL,
    "blob" "bytea"
);


ALTER TABLE "public"."checkpoint_blobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkpoint_migrations" (
    "v" integer NOT NULL
);


ALTER TABLE "public"."checkpoint_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkpoint_writes" (
    "thread_id" "text" NOT NULL,
    "checkpoint_ns" "text" DEFAULT ''::"text" NOT NULL,
    "checkpoint_id" "text" NOT NULL,
    "task_id" "text" NOT NULL,
    "idx" integer NOT NULL,
    "channel" "text" NOT NULL,
    "type" "text",
    "blob" "bytea" NOT NULL
);


ALTER TABLE "public"."checkpoint_writes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkpoints" (
    "thread_id" "text" NOT NULL,
    "checkpoint_ns" "text" DEFAULT ''::"text" NOT NULL,
    "checkpoint_id" "text" NOT NULL,
    "parent_checkpoint_id" "text",
    "type" "text",
    "checkpoint" "jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."checkpoints" OWNER TO "postgres";


ALTER TABLE ONLY "public"."checkpoint_blobs"
    ADD CONSTRAINT "checkpoint_blobs_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "channel", "version");



ALTER TABLE ONLY "public"."checkpoint_migrations"
    ADD CONSTRAINT "checkpoint_migrations_pkey" PRIMARY KEY ("v");



ALTER TABLE ONLY "public"."checkpoint_writes"
    ADD CONSTRAINT "checkpoint_writes_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx");



ALTER TABLE ONLY "public"."checkpoints"
    ADD CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id");





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON TABLE "public"."checkpoint_blobs" TO "anon";
GRANT ALL ON TABLE "public"."checkpoint_blobs" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoint_blobs" TO "service_role";



GRANT ALL ON TABLE "public"."checkpoint_migrations" TO "anon";
GRANT ALL ON TABLE "public"."checkpoint_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoint_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."checkpoint_writes" TO "anon";
GRANT ALL ON TABLE "public"."checkpoint_writes" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoint_writes" TO "service_role";



GRANT ALL ON TABLE "public"."checkpoints" TO "anon";
GRANT ALL ON TABLE "public"."checkpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."checkpoints" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
