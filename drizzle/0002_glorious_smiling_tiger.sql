CREATE TYPE "public"."sso_protocol" AS ENUM('saml', 'oidc');--> statement-breakpoint
ALTER TYPE "public"."channel_type" ADD VALUE 'whatsapp' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."channel_type" ADD VALUE 'facebook' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."channel_type" ADD VALUE 'instagram' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."channel_type" ADD VALUE 'twitter' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text NOT NULL,
	"details" jsonb,
	"ip_address" "inet"
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"conditions" jsonb,
	"actions" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"protocol" "sso_protocol" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"entity_id" text,
	"sso_url" text,
	"certificate" text,
	"client_id" text,
	"client_secret" text,
	"issuer" text,
	"authorization_url" text,
	"token_url" text,
	"user_info_url" text,
	"domain_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sla_policies" ADD COLUMN "priority" "ticket_priority";--> statement-breakpoint
ALTER TABLE "sla_policies" ADD COLUMN "response_time" integer;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD COLUMN "resolution_time" integer;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "customer_email" varchar(320);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "tags" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_timestamp_idx" ON "audit_entries" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_entries_user_idx" ON "audit_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entries_action_idx" ON "audit_entries" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_entries_resource_idx" ON "audit_entries" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "automation_rules_workspace_idx" ON "automation_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "automation_rules_enabled_idx" ON "automation_rules" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE INDEX "sso_providers_domain_idx" ON "sso_providers" USING btree ("workspace_id","domain_hint");--> statement-breakpoint
CREATE INDEX "sso_providers_workspace_idx" ON "sso_providers" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_tenant_idx" ON "tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tickets_customer_email_idx" ON "tickets" USING btree ("workspace_id","customer_email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");