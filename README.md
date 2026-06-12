# BookBarber ✂

A full-stack, production-ready barbershop booking platform built with Next.js 14, Supabase, and Resend.

## Features

- **Multi-shop support** — One admin can manage multiple locations
- **Real-time slot generation** — 25-minute slots based on each barber's live schedule
- **No double-booking** — Enforced at both the application and database (EXCLUDE constraint) level
- **Role-based access** — Admin, Employee, and Customer roles with separate dashboards
- **Email notifications** — Booking confirmed, cancelled, rescheduled via Resend
- **Shop booking links** — Each shop gets a unique `/shop/[slug]` URL to share with customers
- **Holiday/special hours** — Override default schedule per date per shop
- **Audit log** — Full booking change history in `booking_logs`
- **Dark premium UI** — Near-black background with gold accents, fully responsive

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Email | Resend |
| Styling | Tailwind CSS |
| Deployment | Vercel |

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Anas-Baigg/BookBarber.git
cd BookBarber
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RESEND_API_KEY=re_your_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Finding your Supabase keys:** Go to your Supabase project → Settings → API. You need both the `anon` public key and the `service_role` secret key.

### 3. Run the database migrations

In the Supabase SQL editor, run the migration files in order:

1. `supabase/migrations/001_schema.sql` — Creates all tables, triggers, and indexes
2. `supabase/migrations/002_rls.sql` — Sets up Row Level Security policies

> Alternatively, if you have the Supabase CLI installed:
> ```bash
> supabase db push
> ```

### 4. Configure Supabase Auth

In your Supabase project dashboard:

1. Go to **Authentication → Email Templates** and customize the invitation template
2. Go to **Authentication → URL Configuration** and add:
   - Site URL: `http://localhost:3000` (or your production URL)
   - Redirect URLs: `http://localhost:3000/auth/callback`

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## User Roles

### Admin (Shop Owner)
1. Sign up at `/auth/signup`
2. Go to your Supabase dashboard → Table Editor → `profiles`
3. Change your user's `role` from `customer` to `admin`
4. Now access `/admin` to create shops and manage employees

### Employee (Barber)
- Admin adds employees via the **Employees** page in the admin panel
- The system sends them an email invite via Supabase Auth
- They log in at `/auth/login` and access `/employee` for their schedule

### Customer
- Signs up at `/auth/signup` (role = `customer` by default)
- Accesses a shop via the booking URL shared by the owner (e.g., `/shop/fades-by-carlos`)
- Books appointments and manages them via `/dashboard`

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── shop/[shopSlug]/page.tsx    # Public booking page
│   ├── booking/[id]/page.tsx       # Booking management
│   ├── dashboard/page.tsx          # Customer dashboard
│   ├── admin/
│   │   ├── page.tsx                # Admin overview
│   │   ├── shops/page.tsx          # Shop management
│   │   ├── employees/page.tsx      # Employee management
│   │   └── bookings/page.tsx       # Booking log
│   ├── employee/page.tsx           # Employee schedule
│   └── api/
│       ├── bookings/route.ts       # POST — create booking
│       ├── bookings/[id]/route.ts  # PATCH — cancel/reschedule
│       ├── slots/route.ts          # GET — available slots
│       ├── shops/route.ts          # GET — shop data
│       └── employees/route.ts      # POST — add employee
├── components/
│   ├── ui/                         # Button, Input, Card, Badge, Select
│   ├── layout/                     # Navbar, AdminSidebar
│   └── BookingWidget.tsx           # Interactive booking flow
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser client
│   │   ├── server.ts               # Server client
│   │   └── admin.ts                # Service role client
│   ├── emails.ts                   # Resend email templates
│   ├── slot-generator.ts           # Slot generation logic
│   └── utils.ts                    # Helpers, timezone utils
└── types/index.ts                  # TypeScript types
```

## Database Schema

```
profiles          → extends auth.users (role: admin|employee|customer)
shops             → shop locations, owned by an admin
shop_special_hours→ holiday / special hour overrides per date
employees         → barbers, linked to a shop and a profile
employee_schedules→ weekly recurring schedule (day 0–6)
bookings          → appointments (confirmed/cancelled/rescheduled)
booking_logs      → audit trail for all booking changes
```

**Double-booking prevention:** The `bookings` table uses a PostgreSQL `EXCLUDE USING gist` constraint to guarantee that no two confirmed bookings for the same employee overlap — even under concurrent inserts.

## Email Notifications

All emails are sent via [Resend](https://resend.com). Triggered events:

| Event | Recipients |
|---|---|
| Booking confirmed | Customer |
| Booking cancelled (by customer) | Customer + Admin |
| Booking rescheduled (by customer) | Customer + Admin |
| New booking on schedule | Employee |

> To send from a custom domain, verify it in the Resend dashboard and update the `FROM` address in `src/lib/emails.ts`.

## Deploying to Vercel

1. Push the repo to GitHub
2. Import the project in [Vercel](https://vercel.com/new)
3. Add all environment variables from `.env.local` to Vercel's **Environment Variables** settings
4. Update `NEXT_PUBLIC_APP_URL` to your production domain
5. Update Supabase Auth redirect URLs to include your production domain
6. Deploy!

## Development Notes

- All times are stored in **UTC** in the database
- Times are displayed in the **shop's configured timezone** using `date-fns-tz`
- Slot generation is always real-time (no caching) to prevent stale availability
- The `btree_gist` PostgreSQL extension is required for the exclusion constraint — Supabase enables this by default
