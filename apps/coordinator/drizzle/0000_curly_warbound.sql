CREATE TYPE "public"."query_status" AS ENUM('QUOTED', 'FANOUT', 'SETTLED_ONCHAIN', 'FAILED', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."seller_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'AVAILABLE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."verify_mode" AS ENUM('CONSENSUS', 'CONTENT_ADDRESSED', 'REPUTATION');--> statement-breakpoint
CREATE TABLE "queries" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer" text NOT NULL,
	"mode" "verify_mode" NOT NULL,
	"k" integer NOT NULL,
	"max_price" text,
	"fee_amount" text DEFAULT '0' NOT NULL,
	"truth" text,
	"cost" text,
	"status" "query_status" DEFAULT 'QUOTED' NOT NULL,
	"solana_req_pda" text,
	"solana_tx" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" text PRIMARY KEY NOT NULL,
	"query_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"value_or_hash" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"matched" boolean
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"solana_pubkey" text NOT NULL,
	"payout_address" text NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"price" text NOT NULL,
	"mode" "verify_mode" DEFAULT 'CONSENSUS' NOT NULL,
	"category" text NOT NULL,
	"coverage" text[] NOT NULL,
	"schema_desc" text NOT NULL,
	"freshness_sec" integer NOT NULL,
	"reputation" integer DEFAULT 500 NOT NULL,
	"stake" text DEFAULT '0' NOT NULL,
	"served" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"outliers" integer DEFAULT 0 NOT NULL,
	"status" "seller_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_solana_pubkey_unique" UNIQUE("solana_pubkey")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"query_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"amount" text NOT NULL,
	"gateway_tx" text,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queries_status_created_idx" ON "queries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_query_seller_uq" ON "responses" USING btree ("query_id","seller_id");--> statement-breakpoint
CREATE INDEX "sellers_category_status_idx" ON "sellers" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status");