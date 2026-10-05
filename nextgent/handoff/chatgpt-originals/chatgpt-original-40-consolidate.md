This may help too. It may actually put some things together since you still don't know what the fuck you're building.

Yes. I went back through what you’ve actually been saying, then re-checked the repos instead of just extending the last answer. There were several real errors in what I gave you before.

The biggest one: I was still designing around the repos instead of recognizing that you already have most of the exact architecture sitting across them. The correct job is to consolidate and connect what exists, not invent another architecture.

The corrections first

I found five things I had wrong or incomplete.

1. I invented a new business_app_instances-type layer you do not need. gcr-api-clean/routes/platform.js already has entity_modules. It already stores which module is installed for a business, whether it is enabled, whether it shows publicly, its manifest/config snapshot, and its sort order. That is already the runtime installation layer.
2. I treated Paperclip’s Store as though it already supported your modular Apps. It doesn’t yet. The current nextgent/foundation Store supports plugin, pack, skill, automation, and connector. It does not have an app type. The branch is currently 12 commits ahead of master, but Apps need to be added to it deliberately. (CultureReset/paperclip, packages/db/src/schema/store.ts)
3. I undersold App-build-. That repo is not merely some old prototype to cherry-pick a couple ideas from. It is the closest thing you already have to the exact modular app engine you are describing. Its own contract literally says: “An app is a declaration — a manifest — and one shared runtime renders every manifest.” It already has public/admin surfaces, an app builder, page studio, layouts, installable apps, and a shared renderer. (CultureReset/App-build-, src/lib/modules/spec.ts, src/components/public/PublicSurface.tsx)
4. The old CyberCheck app manifest is not the one I would use for the final modular apps. cybercheck-marketplace was explicitly an earlier attempt, and its app-manifest.v1 expects hosted/service executable runtimes. Your newer App-build- model is better for what you’re describing because ordinary Apps are declarations interpreted by the shared runtime—not independent hosted codebases.
5. The README on the Paperclip NEXT GENT branch is wrong for the architecture you have now chosen. It currently says Paperclip is the product, nothing else holds business state, and NEXT GENT does not use gcr-api-clean. That conflicts directly with the actual business platform you already have and with what you have been describing. That README needs to be rewritten when the bridge is restored.

That changes the build considerably.

⸻

The actual finished system

The finished architecture is this:

                         NEXT GENT
                             │
             ┌───────────────┴────────────────┐
             │                                │
        PLATFORM SIDE                    BUSINESS SIDE
             │                                │
          PAPERCLIP                     gcr-api-clean
             │                                │
   accounts / companies                  entity/business
   Store catalog                         business data
   installed versions                    entity_modules
   agents                                menus
   automations                           products
   tasks                                 listings
   approvals                             availability
   releases                              bookings
             │                           media/reviews/etc.
             │                                │
             └──────────────┬─────────────────┘
                            │
                      APP RUNTIME
                 from App-build-
                            │
            ┌───────────────┴──────────────┐
            │                              │
      OWNER/BACK END                 PUBLIC/FRONT END
         Play-user                      gcr-unified
            │                              │
      installed app                   installed app
      admin surfaces                  public surfaces
            │                              │
            └────────── same data ─────────┘

And below that:

                         AI / ACTION SIDE
                      Jarvis / Paperclip
                              │
                         workers/agents
                              │
                      nextgent-platform
                              │
             ┌────────────────┼────────────────┐
             │                │                │
          Android          Browser           Linux
             │
         App Maps
             │
       verification
             │
          receipt

Those are different jobs. Do not combine them.

⸻

1. Paperclip is the control plane, not the business database

Paperclip should own:

Accounts
Companies
Memberships
Store catalog
Store versions
Install entitlement
Stable/Fast release channels
Automatic/manual updates
Agents
Automations/Routines
Skills
Connectors
Tasks
Approvals
Agent runs
Activity
Costs
Secrets

It should not own:

menu items
restaurant hours
charter trips
products
photos
listings
availability
customer bookings
reviews

Those belong to the business-data side.

The existing nextgent/foundation Store implementation is useful and should be merged/ported to current Paperclip.

But it needs to be extended.

Right now:

plugin
pack
skill
automation
connector

I would make the final Store understand:

app
agent
automation
connector
skill
layout
pack

plugin can remain for internal/platform plugins.

A pack is simply:

install these independent Store items together.

A restaurant starter pack might install:

Profile
QR Menu
Gallery
Reviews
Availability
Book

Those remain six separate Apps.

⸻

2. App-build becomes the actual modular-app engine

Do not throw this repo away.

Repurpose it.

It already contains:

module manifest specification
manifest validation
app builder
admin runtime
public runtime
public templates
display variants
page design system
layouts
permissions derivation
versioned manifests
installed apps
QR/public page support

Its current built-ins include:

Listings
Action Buttons
Social Links
Lead Capture
Gallery
Video
FAQ
Link Hub
QR Menu
Song Requests

That is already very close to the Store you have been explaining.

But don’t keep its:

separate login
separate account system
separate Store authority
separate Supabase world

Those pieces become unnecessary.

The repo becomes something closer to:

App-build-
│
├── app manifest contract
├── app builder
├── shared admin renderer
├── shared public renderer
├── page builder
├── theme/layout engine
├── template library
└── runtime tests

Then Play-user and gcr-unified use the same runtime.

No duplicated Gallery renderer.

No duplicated Menu renderer.

No duplicated Song Request renderer.

⸻

3. The current App-build manifest needs one important upgrade

The existing manifest assumes a module owns collections.

That’s good for something like Song Request:

requests

because Song Request genuinely creates its own records.

But it is not enough for your new model.

You need to distinguish:

data an App OWNS

from

existing business data an App USES

That is the key evolution.

I would change the manifest concept to something like:

id: qr-menu
version: 1.0.0
name: QR Menu
surfaces:
  public:
    template: menu
    modes:
      - inline
      - card
      - page
  admin:
    template: menu-editor
bindings:
  menu:
    contract: menu.items
    access: read-write
  media:
    contract: media.images
    access: read
owns: {}
settings:
  show_images: true
  show_descriptions: true
  show_sold_out: true

QR Menu doesn’t need to invent another menu database.

It says:

Give me something that satisfies menu.items.

⸻

4. Connectors satisfy those data contracts

This is the vendor-independent part you’ve been describing.

QR Menu wants:

menu.items

That might be supplied by:

CyberCheck native menu
Square
Toast
Clover
CSV
Spreadsheet
website import
manual entry

The App does not change.

Same thing with Availability.

Availability App
requires:
    availability.read

Possible source:

HubSpot
Salesforce
Google Calendar
Outlook
FareHarbor
Peek
iCal
your own booking system
CyberCheck
manual schedule

Again:

App ≠ Connector.

Architecture:

                       AVAILABILITY APP
                      "I need availability"
                              │
                              ▼
                     DATA CONTRACT LAYER
                       availability.read
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          HubSpot         Google Cal       CyberCheck
         connector         connector         native

This is how you build it once.

⸻

5. Do not rebuild the data router: gcr-api-clean already has most of it

This was an important thing I verified.

gcr-api-clean/routes/platform.js already says:

Business = entity row
Installed modules = entity_modules
Universal booking = bookings
Bookable products/services/etc. = offerings
All availability claims = booking_calendar
Photos = entity_photos
Events = entity_events
Menu = menu_items
Reviews = entity_reviews

And anything that does not have a purpose-built table can fall into:

entity_sections
entity_section_items

It already has a data dispatch layer where a module asks for a logical data key and the backend maps it onto the real business tables.

That is extremely close to what you’re describing.

So the job is not:

design another canonical business database.

The job is:

clean up and formalize the existing data contracts in routes/platform.js.

For example:

menu.items
       ↓
menu_items
media.images
       ↓
entity_photos
reviews.items
       ↓
entity_reviews
events.items
       ↓
entity_events
booking.records
       ↓
bookings
availability.claims
       ↓
booking_calendar
products.items
       ↓
offerings kind=product

⸻

6. entity_modules is your installed-App runtime

This already exists.

It currently holds:

entity_slug
module_key
enabled
settings
sort_order

and its settings can already contain:

manifest
config
showOnPublic

That means the finished install flow can be:

Paperclip Store
      │
      │ install "QR Menu"
      ▼
Paperclip store_install
      │
      │ internal CyberCheck bridge
      ▼
gcr-api-clean
      │
      ▼
entity_modules
      │
      ├── module_key = qr-menu
      ├── manifest = pinned manifest
      ├── config = this restaurant's settings
      ├── enabled = true
      ├── showOnPublic = true
      └── sort_order = 4

I do not need to invent another runtime-install table.

⸻

7. Paperclip needs an internal CyberCheck bridge

This is one of the actual missing pieces.

Current Play-user talks only to Paperclip.

That is fine.

Keep it that way.

Don’t put CyberCheck credentials in the browser.

Build an internal Paperclip integration:

Play-user
   │
   ▼
Paperclip
   │
   ▼
CyberCheck bridge
   │
   ▼
gcr-api-clean

For every company store:

paperclip company id
        ↕
CyberCheck entity slug/business

and a private business credential.

So:

Paperclip company:
aaf8...
CyberCheck:
sandbar-grill

are permanently associated.

The earlier CyberCheck Paperclip plugin you had was going in this direction. Restore it as an internal platform integration, not as an App the customer sees in the Store.

⸻

8. Onboarding creates that link

The real signup flow becomes:

Create NEXT GENT account
        ↓
Create company
        ↓
Find existing business
or
Create new business
        ↓
Claim/verify it
        ↓
Link:
Paperclip company ↔ CyberCheck entity
        ↓
Import business data
        ↓
Open Store

Old claim/business screens in Play-user and the GCR dashboards can be reused rather than rewritten.

⸻

9. Data can enter the business from many directions

There isn’t one ingestion pipeline.

There are several doors.

manual edit
POS
CRM
calendar
booking service
CSV
spreadsheet
email
web import
API
Android
browser
agent
Scout

All of them ultimately expose normalized business data.

You can support three modes.

Native

NEXT GENT owns the record.

Example:

owner adds menu item manually

Synced

External system is authoritative, but NEXT GENT keeps a normalized copy.

Example:

Toast
  ↓
menu sync
  ↓
menu_items

Live

NEXT GENT asks the connector when the App needs it.

Example:

Salesforce
  ↓
live query
  ↓
availability response

Different data sources can use different modes.

The App does not care.

⸻

10. Internal ID, SKU and vendor IDs are all different things

You were right about this.

Example:

NEXT GENT menu item id
84291
restaurant SKU
BURG-14
Square item
K92QL30
Toast item
554109

All can refer to:

Sandbar Cheeseburger

Your internal ID remains stable.

Everything else is an external identity.

If there isn’t already an appropriate mapping structure in the database, add one consistent external-reference mapping rather than stuffing provider IDs randomly into app code.

Conceptually:

entity_external_refs
entity_type
entity_id
provider
connection_id
external_id
external_sku
last_synced_at

But I would first audit existing platform_connections and provider-specific tables before adding it, because gcr-api-clean already has a large connection layer.

⸻

11. Front end is modular

This is where the A9ENT/MySet concept comes in.

They are UI/UX references, not dependencies.

The public page shell is just:

BUSINESS PAGE
│
├── Profile
├── Call
├── Book
├── Social Links
├── Menu
├── Availability
├── Gallery
├── Reviews
├── Events
└── Merch Store

Every installed App contributes its own public surface.

The owner can:

install
remove
enable
hide
reorder
change display style
give it its own URL
show inline
show as card
show as button

⸻

12. Back end is modular in the same way

Installed Apps also contribute owner surfaces.

Sandbar might have:

Apps
QR Menu
Availability
Gallery
Reviews
Events
Merch Store

Gulf Runner:

Apps
Book
Availability
Listings
Gallery
Reviews
Merch Store

A musician:

Apps
Book
Events
Gallery
Song Request
Crowdsource a Song
Shoutout Request
Merch Store

The dashboard isn’t hardwired by industry.

It reads the company’s Store installs and renders the applicable admin surfaces.

⸻

13. The runtime needs richer front-end templates than it has now

This is where the shitty QR menu prototype exposed something real.

App-build- currently has generic templates like:

catalog
form
gallery
listings
actions
socials
FAQ

Architecture is correct.

The templates themselves need to become much better.

I would expand the renderer library to include:

profile
menu
storefront
product-detail
gallery
availability
booking
appointment
schedule
listings
listing-detail
events
reviews
testimonials
form
request
voting
links
actions
social
FAQ

So QR Menu does not look like a generic database list.

The menu public template owns:

large food photos
horizontal category scroller
sticky category nav
item cards
price
description
badges
sold-out state
item detail
modifiers
mobile-first scrolling

Same App manifest.

Much better renderer.

⸻

14. Back-end templates need the same treatment

Don’t make every owner App look like a generic CRUD table either.

Create admin templates.

Examples:

menu-editor
media-manager
product-manager
inventory
orders
availability-calendar
booking-manager
listing-manager
requests-inbox
voting-session
event-manager
review-manager

Then an App declaration can say:

admin:
  template: menu-editor

or:

admin:
  template: requests-inbox

This is how you get modular front end + modular back end without writing a custom application for every business.

⸻

15. Example: QR Menu

Store item:

QR Menu

Not:

Toast QR Menu
Square QR Menu
Restaurant QR Menu

Data contract:

menu.items
media.images

Public renderer:

menu

Admin renderer:

menu-editor

Possible data source:

Toast
Square
Clover
CyberCheck
CSV
manual

One App.

⸻

16. Example: Gallery

Gallery

Requires:

media.images

Public:

gallery

Admin:

media-manager

Fishing charter installs it.

Restaurant installs it.

Realtor installs it.

Musician installs it.

Exactly the same App.

⸻

17. Example: Book

Book

Uses:

availability.read
booking.create
offerings.read

It can display differently through configuration:

Book a Trip
Reserve
Book a Session
Book Now

But if the experience is materially different, you can still have separate Apps:

Book
Book Appointment
Schedule
Request Booking

They may share 90% of the same runtime underneath.

That’s fine.

Apps are a product boundary, not necessarily a unique codebase.

⸻

18. Song Request is exactly one independent App

The current App-build- Song Request manifest already proves the model.

It declares:

requests
song
artist
from
note
status

Public surface:

form

Admin side:

request records

The runtime renders it.

And crucially:

Crowdsource a Song

is a different manifest.

Shoutout Request

is another different manifest.

Related does not mean bundled.

⸻

19. Apps can use shared business data AND own their own data

This is the final data rule.

QR Menu

Uses:

menu_items

Mostly shared business data.

Gallery

Uses:

entity_photos

Shared data.

Availability

Uses:

booking_calendar

Shared data.

Song Request

Owns:

requests

App-specific records.

Crowdsource

Owns:

sessions
options
votes

App-specific records.

Merch Store

Uses/owns a combination:

products
inventory
orders

The runtime needs both ideas.

⸻

20. Layout is separate from App

This is another part we need to preserve from App-build.

A layout might look like:

A9ENT-style professional profile

or:

MySet-style creator page

or:

Restaurant visual

That layout says:

theme
header shape
block styles
default order
spacing
page width
button shape

It does not own business data.

It doesn’t make:

A9ENT Listings

Listings stays:

Listings

The layout just changes how that installed Listings App sits on the page.

⸻

21. gcr-unified becomes one consumer of the same runtime

It is already React + Vite.

It already reads gcr-api-clean.

So don’t rebuild public GCR.

Add a shared runtime renderer.

Existing:

/business/:slug
/menu/:slug
/review/:slug
/links/:slug
...

can continue while you transition.

Then introduce a general installed-App renderer:

/business/:slug
      ↓
load entity
      ↓
load entity_modules
      ↓
for each enabled public App
      ↓
shared App-build public renderer

A dedicated App URL can resolve as:

/:slug/apps/:app

or whatever route pattern you settle on.

⸻

22. Play-user becomes the owner shell, not the app engine

Current Play-user is basically:

Home
Store

and only knows Paperclip.

Keep the shell.

Grow it into:

Home
Business
Apps
Agents
Automations
Calendar
Messages
Computer
Activity
Settings

But the installed App admin screens are supplied by the shared App runtime.

So:

Play-user
      ↓
"QR Menu installed"
      ↓
load qr-menu manifest
      ↓
admin runtime
      ↓
menu-editor

You don’t hand-build another QR Menu admin page in Play-user.

⸻

23. Plat-admin stays platform administration

Current Plat-admin already has a very large amount of older CyberCheck/GCR UI still in the repo.

Do not delete it blindly.

Final operator console:

Companies
Users
Store
Apps
Agents
Automations
Connectors
Layouts
Releases
Business Data
Connections
Devices
Executions
Approvals
Maps
Deployments
Billing
Support
System

Harvest old GCR screens where useful.

But Store publishing goes through Paperclip.

Business data operations go through CyberCheck.

⸻

24. Retire the duplicate Stores carefully

You currently have multiple Store ideas:

Paperclip Store
gcr-api-clean Store
App-build Store
cybercheck-marketplace
nextgent-store
plugin-marketplace

Final authority:

PAPERCLIP STORE

But do not throw useful code away.

From gcr-api-clean/routes/store.js, keep/port:

publishing
version history
permission changes
staged rollout
entitlement logic
release/offer/install/force concepts

From App-build, keep:

app manifest
app builder
runtime
layouts
public/admin renderer

From cybercheck-marketplace, preserve any contract ideas worth using, but don’t revive its hosted-code runtime model.

Then archive/disable duplicate Store authorities after migration.

⸻

25. Agent/automation Apps remain separate concepts

Do not put them inside public Apps.

Example:

Verified Reviews
       = App
Review Agent
       = Agent
Review After Visit
       = Automation

They can communicate through events/data.

Example:

booking.completed
        ↓
Review After Visit automation
        ↓
Review Agent
        ↓
send review request
        ↓
Verified Reviews App

Three Store artifacts.

⸻

26. Paperclip controls agents/work

Paperclip should remain the orchestrator.

Jarvis:

owner-facing executive/conversational agent

Hermes:

worker

Research Agent:

worker

Social Agent:

worker

Review Agent:

worker

Do not keep the old Harness task graph running as another control plane.

Harvest the Hermes profiles from Harness.

Register them as Paperclip workers.

⸻

27. Jarvis gets two main doors

Jarvis needs:

Paperclip tools

for:

create task
assign worker
read result
approvals

and:

Business MCP

for:

read/edit business data

plus:

nextgent-platform capability tools

for actions outside your system.

So:

                    JARVIS
              ┌───────┼────────┐
              ▼       ▼        ▼
         Paperclip  Business   Local
           work       MCP     executor

⸻

28. gcr-api-clean’s MCP is already exactly the right business doorway

routes/mcp.js already does the right security thing:

The credential decides the business.

The caller cannot supply a different slug.

It can:

list sections
describe section
read rows
create row
update row
delete row

This should remain the AI-facing business door.

Do not create a second database MCP.

⸻

29. Local Android architecture stays separate

Nothing about the modular web Apps changes your device architecture.

nextgent-platform owns:

capabilities
policy
ALLOW / ASK / DENY
approval
Android execution
verification
receipts

Jarvis does not ADB directly.

Paperclip does not ADB directly.

Boxes does not ADB directly.

Everything routes through the platform executor.

⸻

30. App Maps stay data-only

nextgent-maps remains:

capability
↓
known screen states
↓
known transitions
↓
verification

No customer credentials.

No Store business data.

No agent logic.

If Facebook changes its UI:

change Map

rather than:

rewrite Jarvis
rewrite Paperclip
rewrite Android executor

⸻

31. Trailblaze is useful for authoring/testing Maps

I checked that repo again too.

It is good for:

device snapshot
agent-driven exploration
save trail
deterministic replay
trace viewer
self-heal during development

Use it as a development/calibration tool.

Not as a replacement for your production executor.

A good pipeline is:

UI changed
  ↓
Trailblaze / discovery
  ↓
tested sequence
  ↓
NEXT GENT Map
  ↓
candidate
  ↓
acceptance runs
  ↓
released

⸻

32. nextgent-scout fits data ingestion

That repo already does:

discover business sites
harvest raw pages
save PDFs/files
parse later
record source quality
produce menu upserts

That is a data acquisition connector/worker.

It is not a Store renderer.

Example:

Scout
  ↓
find menu
  ↓
parse JSON-LD/PDF/text
  ↓
CyberCheck menu data
  ↓
QR Menu automatically has content

That is a perfect example of the separation you’re after.

⸻

33. nextgent-match is a specialized data engine

It does:

QR scan
+
POS ticket
↓
confidence match
↓
verified transaction context

Use it behind:

Verified Reviews

It doesn’t become its own UI unless you choose to expose one.

Again:

engine ≠ public App.

⸻

34. Boxes stays the local display

Boxes:

Home
Apps
Agents
Automations
Files
Calendar
Computer
Android
Ask
Activity

It is a screen.

Not the execution brain.

Any mutation:

Boxes
 ↓
nextgent-platform
 ↓
policy
 ↓
executor

⸻

35. ang-contract stays the shared rulebook

Keep things like:

module manifests
capability requests
events
receipts
tasks

there if they are cross-local-runtime contracts.

Do not stuff web App manifest UI definitions into it unless those definitions genuinely need to be consumed by the appliance.

The modular web App manifest belongs with the App runtime.

⸻

36. ang-core / ang-cloud remain local

ang-core-:

local state
kernel data
ledger
offline state

ang-cloud- despite the name:

local owner API
local owner shell
receipt view

Do not turn those into your cloud SaaS.

⸻

37. nextgent-ghost-image remains appliance assembly

It already has the correct Lego philosophy.

It installs:

ang-contract
ang-core
nextgent-maps
nextgent-platform
Boxes
nextgent-openjarvis
ang-cloud
Harness

each pinned independently.

Keep that.

Signed release.

Health check.

Rollback.

No need to rebuild the appliance installer.

⸻

38. The real install experience for a business App

Say Sandbar wants QR Menu.

Customer experience:

STORE
QR Menu
★★★★☆
Beautiful mobile menu...
[ INSTALL ]

Tap Install.

INSTALL QR MENU
Business
The Sandbar Grill

Next:

WHERE IS YOUR MENU?
✓ CyberCheck Menu
Connect:
Toast
Square
Clover
Import:
CSV
Spreadsheet
or
Enter manually

If it already has compatible menu data:

don’t ask them to reconnect anything.

Use it.

Next:

DESIGN
Images            ON
Descriptions      ON
Prices            ON
Sold-out items    SHOW
Categories        SCROLLING

Next:

PREVIEW

Then:

PUBLISH

Behind the scenes:

Paperclip Store install
      ↓
pinned app manifest
      ↓
CyberCheck bridge
      ↓
entity_modules
      ↓
data binding
      ↓
public surface
      +
admin surface

That’s what “downloading the App” actually means in your system.

No binary download is necessary for ordinary declarative Apps.

⸻

39. How updates work

You publish:

QR Menu 1.1.0

Paperclip knows:

business currently:
1.0.0
latest:
1.1.0

Automatic channel:

update install

Manual:

Update Available

The pinned manifest changes.

The business data doesn’t.

The restaurant does not lose its menu.

The page design does not disappear.

⸻

40. How uninstall works

Uninstall:

disable App surfaces
remove it from public page
remove owner menu entry

But by default:

DO NOT DELETE THE BUSINESS'S DATA

Gallery uninstall does not delete photos.

QR Menu uninstall does not delete menu items.

Song Request records could be retained/archived.

Reinstall brings the capability back.

⸻

41. Exact build order

This is the sequence I would actually execute now.

Phase 1 — Lock the authorities

Declare these final owners:

Paperclip
= platform/control plane + Store
gcr-api-clean
= business/data plane + business MCP + relay
App-build-
= modular App specification/runtime/builder
nextgent-platform
= local execution

Rewrite conflicting READMEs after that.

Phase 2 — Merge Paperclip Store

Bring nextgent/foundation onto the current Paperclip branch.

Tests green.

Do not add Apps yet until Store base is stable.

Phase 3 — Add real Store kinds

Extend Paperclip Store with:

app
agent
layout

Reuse current:

automation
connector
skill
pack
plugin

Phase 4 — Build Paperclip↔CyberCheck bridge

Company ↔ entity mapping.

Business credential stays server-side.

Expose business data through Paperclip to Play-user.

Phase 5 — Stop duplicating the App Store

Freeze new features in:

gcr Store
App-build standalone Store
old marketplace repos

Do not delete yet.

Phase 6 — Extract App-build runtime

Preserve:

spec
builder
runtime
public templates
admin runtime
layouts
theme engine
tests

Turn it into the shared runtime consumed by the real surfaces.

Phase 7 — Extend the App manifest

Add the distinction:

bindings
= shared business data
collections/owns
= app-specific data

Add:

public surface template
admin surface template

Phase 8 — Bind runtime installs to entity_modules

Paperclip App install:

store_install
→ entity_modules

No new duplicate installation table.

Phase 9 — Build proper renderer templates

First:

Profile
Actions
Social Links
Gallery
QR Menu
Listings
Availability

Make these look production quality.

Not generic CRUD.

Phase 10 — Build admin templates

First:

profile-editor
media-manager
menu-editor
listing-manager
availability-calendar

Phase 11 — Wire Play-user

Installed Apps dynamically supply admin navigation/screens.

Store listing uses real screenshots and previews.

Phase 12 — Wire gcr-unified

Public business page dynamically stacks installed public App surfaces.

Existing GCR routes continue to work during migration.

Phase 13 — Data connector contract

Formalize capabilities:

menu.items
media.images
availability.read
booking.create
products.read
listings.read
contacts.read
events.read
reviews.read

Map existing sources to them.

Phase 14 — Reuse existing ingestion

Wire:

Scout
email parsing
iCal
existing booking parser
POS connections
CRM connections
CSV/manual

into canonical contracts.

Phase 15 — Build interactive Apps

Then:

Book
Book Appointment
Schedule
Contact
Quote Request
Private Events
Song Request
Crowdsource a Song
Shoutout Request
Loyalty
Merch Store

Phase 16 — Agents/automations

Paperclip Store separately publishes:

Booking Agent
Social Agent
Review Agent
Review After Visit
Last-Minute Opening
Daily Update

Phase 17 — Jarvis

Jarvis gets:

Paperclip tools
Business MCP
NEXT GENT execution tools

Phase 18 — Local executor

Finish physical Android acceptance testing.

Current source reality: android.settings.open_display is the first candidate acceptance capability; android.sms.send is still draft in Maps. Do not pretend the whole Android catalog is finished yet. (nextgent-platform/README.md, nextgent-maps/README.md)

Phase 19 — Device relay

Keep the existing gcr-api-clean/routes/nodes.js outbound-polling relay.

Do not invent a second relay.

Phase 20 — Appliance

Use nextgent-ghost-image to ship pinned local blocks, health-check, update and roll back.

Then do the actual pilot.

⸻

What the final repo relationships look like

paperclip
│
├── Store
├── companies
├── users
├── agents
├── automations
└── internal CyberCheck bridge
       │
       ▼
gcr-api-clean
│
├── business/entity
├── entity_modules
├── platform data dispatch
├── business MCP
├── public MCP
├── bookings/availability
├── connectors/data
└── node relay
App-build-
│
├── app manifest
├── builder
├── runtime
├── admin templates
├── public templates
├── themes
└── layouts
       │
       ├────────────► Play-user
       │              owner surface
       │
       └────────────► gcr-unified
                      public surface
Jarvis
│
├── Paperclip
├── business MCP
└── nextgent-platform
        │
        ├── nextgent-maps
        ├── Android
        ├── browser
        ├── policy
        ├── approvals
        └── receipts
Boxes / ang-cloud
        │
        └── local user surfaces
nextgent-ghost-image
        │
        └── installs local blocks

That is the architecture I should have given you before.

The main takeaway is you are much further along than my previous answer made it sound. The exact modular-web-app concept is already substantially implemented in App-build-, the business-side installation/data dispatcher already exists in gcr-api-clean, and the Store/control plane already substantially exists in Paperclip. The actual work is to make those three agree on one app manifest/install contract and then wire Play-user and gcr-unified to the same runtime.

That is the center of the build. Everything else—agents, Android, Jarvis, Maps, Boxes, appliance updates—plugs around it rather than redefining it.