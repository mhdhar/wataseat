# Technology Stack

**Analysis Date:** 2026-03-29

## Languages

**Primary:**
- TypeScript 6.0.2 - All production and build code

## Runtime

**Environment:**
- Node.js (version specified in CI/deployment only)

**Package Manager:**
- npm (dependencies in `package.json`)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js 5.2.1 - REST API and webhook handlers at `src/server.ts`
- Node-Cron 4.2.1 - Scheduled jobs at `src/jobs/scheduler.ts`

**Testing:**
- Not detected

**Build/Dev:**
- TypeScript 6.0.2 - Type checking and compilation via `npm run build`
- tsx 4.21.0 - Development watch mode via `npm run dev`
- ts-node 10.9.2 - TypeScript execution in development
- Nodemon 3.1.14 - Process restart on file changes (available but see tsx for actual dev setup)

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.100.1 - PostgreSQL database client and ORM (`src/db/supabase.ts`)
- `stripe` 21.0.1 - Payment processing and Stripe Connect (`src/services/stripe.ts`, `src/services/stripeConnect.ts`)
- `@upstash/redis` 1.37.0 - In-memory cache for state machines (onboarding, trip wizard, cancel confirmation)
- `axios` 1.13.6 - HTTP client for Meta WhatsApp Cloud API (`src/services/whatsapp.ts`)
- `zod` 4.3.6 - Schema validation and TypeScript type inference

**Infrastructure:**
- `helmet` 8.1.0 - HTTP security headers at `src/server.ts`
- `express-rate-limit` 8.3.1 - Rate limiting (100 req/min on webhook endpoints)
- `cors` 2.8.6 - Cross-origin resource sharing configuration
- `pino` 10.3.1 - Structured JSON logging (`src/utils/logger.ts`)
- `pino-pretty` 13.1.3 - Development-only colored log output
- `pg` 8.20.0 - Native PostgreSQL driver (dependency of Supabase client)
- `dotenv` 17.3.1 - Environment variable loading from `.env`

**Type Support:**
- `@types/express` 5.0.6 - Express type definitions
- `@types/node` 25.5.0 - Node.js built-in types
- `@types/cors` 2.8.19 - CORS middleware types
- `@types/node-cron` 3.0.11 - Cron scheduler types

## Configuration

**Environment:**
- `.env` file required (see `.env.example` for complete list)
- Environment variables for:
  - Meta WhatsApp Cloud API credentials (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`)
  - Stripe API keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
  - Supabase connection (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
  - Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
  - App deployment (`PORT`, `APP_URL`, `NODE_ENV`)
  - Business logic (`PLATFORM_COMMISSION_RATE` = 0.10, `THRESHOLD_CHECK_HOURS_BEFORE`, `STRIPE_AUTH_REAUTH_DAYS`)

**Build:**
- `tsconfig.json` - TypeScript compilation:
  - Target: ES2022
  - Module: CommonJS
  - Output: `./dist` directory
  - Strict mode enabled
  - Source maps and declarations enabled

## Platform Requirements

**Development:**
- Node.js runtime
- npm for package management
- ngrok (optional, for local webhook testing)
- Express.js environment

**Production:**
- Node.js runtime
- Cloud deployment platform (Railway, etc. referenced in `.env.example`)
- Database: Supabase PostgreSQL hosted
- Cache: Upstash Redis (REST API)
- Payment processor: Stripe
- Messaging: Meta WhatsApp Cloud API

---

*Stack analysis: 2026-03-29*
