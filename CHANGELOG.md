# Changelog

## v2.2.0 — 2026-11-15

## What's changed

- #minor Enhance App component with Discord integration and log sharing features (d82605a)
- Merge branch 'release' into develop (6edc568)
- Update CHANGELOG for version 2.2.0 and enhance AppVersionBadge component with ChangelogView (6b5b978)
- Refactor styles and layout for improved responsiveness and visual consistency (d511403)
- Implement enhanced Discord authorization flow and layout handling (d2e08c1)
- Add Discord command timeout handling and optional activity configuration (9d7a878)
- Add grapheme handling and text measurement functions for improved rendering (09103e0)
- Add warning level support to CommandLog and OfficialLogEntry models (a88426b)
- Remove share-preview.html file as part of the refactoring process to streamline log sharing functionality. This deletion eliminates outdated code related to rendering share cards, contributing to a cleaner codebase and improved maintainability. (78c19a4)
- Refactor logShareCard rendering logic for improved layout and visual effects (4141582)
- Add gifenc package and update log sharing functionality (1ea4ddc)
- Implement activity invitation and log sharing features in App component (9e0a1c1)
- Enhance App component with Discord user profile integration and voice indicators (0a9c934)

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.1.1...v2.2.0

## v2.2.0 — 2026-11-15

## What's changed

### Friends & sharing
- Invite someone into the activity from the roster (Discord invite dialog, or a share link)
- Share a shock, vibrate, or beep from the log as an animated card in Discord (desktop activity)
- Shared cards show a warning pill when a pre-shock warning was sent
- Roster avatars show who is speaking or muted when voice access is allowed

### Discord & layout
- Discord connect times out and retries cleanly, and the activity still opens if voice permission is declined
- Official remote layout fits more window sizes

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.1.1...v2.2.0

## v2.1.1 — 2026-11-15

## What's changed

- #patch Refactor responsive design and UI components for better compatibility (a637006)
- Refactor responsive design and UI components for better compatibility (3f88763)

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.1.0...v2.1.1

## v2.1.0 — 2026-11-15

## What's changed

- #minor  Enhance application features, UI, and API key management (62e73f8)
- Refactor version management and enhance release notes integration (fef6db4)
- Enhance version management and release notes integration (7129b68)
- Implement Discord safe area handling and enhance responsive design (8e1713f)
- Enhance data management and UI components for PiShock (071e418)
- Enhance user profile handling and API key management (f28c813)
- Enhance control snapshot management and session handling (29c826f)
- Merge pull request #7 from Xeravax/feature/api-key (73f41fe)
- Fix emergency stop and hold cancellation races, enforce current participant limits, and improve API key setup recovery (daff64f)
- Enhance App component and improve command queue handling (9a4500b)
- Refactor App component and enhance error handling across various modules (361341d)
- Enhance App component state management and UI interactions (cb04860)
- Enhance PiShock session management and API key handling (faaf25b)
- Refactor command queue and participant routes to eliminate share code handling (0fba788)
- Refactor SharesPanel and related components to remove link management functionality (5e2c965)
- Enhance API key rejection handling for GET /Links endpoint (e60ab98)
- Implement PiShock API key rejection handling and enhance session management (61b6583)
- Refactor API key handling and enhance UI components for better user experience (1920b17)
- Enhance device management and pause synchronization features (6d55104)
- Refactor participant route to streamline hubClientId assignment (e87fa80)
- Enhance ActivityShare and CommandLog models with additional fields for improved device management (0f9b2f4)
- Add minimum intensity and duration settings to DEMO_STATUS in DemoApp component (f5cd8ba)
- Refactor API handling and enhance participant management features (5ae71b4)
- Add default start menu functionality to App component (1ca1690)
- Enhance DiscordUser and ActivityShare models by adding new fields for activity limits, including minimum and maximum intensity and duration for shock, vibrate, and beep functionalities. Update App and related components to manage these new settings effectively, ensuring proper integration with user interactions and state management. Refactor styles for improved layout and responsiveness in activity limits settings. Adjust API key handling to reflect changes in expiration logic and improve user feedback during the linking process. (6c3c2f8)
- Refactor styles and components for improved layout and responsiveness. Update FriendsParticipantList to enhance participant display and interaction, including scroll handling. Modify OfficialController and PsDialog for better dialog management and styling consistency. Adjust duration presets in OfficialController for refined user experience. Enhance overall CSS for better visual feedback and usability across various components. (c27fad7)
- Enhance application versioning and queue management features. Update the write-version script to include a builtAt timestamp in the version info. Modify the API to send client version information and handle outdated client scenarios. Refactor the App component to manage queue states, including paused and halted conditions, and improve participant interaction based on queue status. Update styles for better visual feedback on queue states and enhance user experience in the login and API key submission processes. (b1dca4d)
- Update GitHub workflows to include 'feature/api-key' branch for Docker publishing and testing. Enhance PiShockSession model by adding fields for pishockUsername, expiresAt, and apiKeyId. Introduce ApiKeyRevealPanel in the App component to manage API key display and handling. Update styles for API key presentation and modify LinkConfirmPanel to reflect API key creation process. Refactor server session management to support new API key functionality and ensure proper handling of session expiration. (eb4d453)
- Refactor command queue settings in DiscordUser model and related components. Remove maxSenderMs from queue configurations and update relevant components to reflect this change. Enhance App and QueuePanel to manage queue state and display updated information. Improve styling for queue-related UI elements and ensure consistent handling of queue operations across the application. (c41b349)
- Enhance command queue functionality in the DiscordUser model and related components. Introduce new settings for command queue management, including progress time, maximum commands per sender, and star-only access. Update App component to manage these settings and integrate them into the queue operations. Refactor FriendsParticipantList to reflect queue access rules and enhance real-time event handling for queue state updates. Update server routes to support command queue settings and improve participant interaction based on queue configurations. (4da96a4)
- Implement command queue functionality in DiscordUser model and related components. Introduce ActivityQueueStar model for prioritizing commands from specific users. Update App component to manage queue state and integrate queue operations such as enabling, pausing, skipping, and clearing the queue. Enhance FriendsParticipantList to allow users to star participants for queue priority. Update real-time event handling for queue state and ticket management. Refactor server routes to support command queue operations and integrate with existing participant functionality. (ca9b9fc)
- Enhance App and DemoApp components to support individual intensity toggling alongside multi-shock functionality. Update FriendsParticipantList to conditionally render the IndividualIntensityToggle based on multi-select state. Introduce new styles for individual intensity toggle buttons and update AppVersionBadge to reflect client version status more accurately. Refactor useAppHealth hook to manage outdated state and force reload logic for improved application health reporting. (e09bec5)
- Enhance App and PipIncomingShock components to support personal and activity hit tracking. Update styles for PIP surface to display target user information, including avatar and display name. Introduce new CSS classes for improved layout and responsiveness. Refactor OfficialController to manage duration limits and integrate visual indicators for over-limit scenarios in duration selection. (e5e9bd8)
- Refactor FriendsParticipantList and related components to enhance multi-select functionality. Update App and DemoApp to pass onToggleMultiShock prop for improved multi-shock handling. Simplify styles for unlinked friends and adjust button interactions for better user experience. Integrate color handling for shockers using a centralized color function. Clean up unused code and improve overall component structure. (9341dc2)
- Enhance setup flow and UI components for Discord sharing functionality. Introduce new state management for device readiness and setup phases in the App component. Refactor ActivityLimitsSettings and AvailabilitySettings to utilize LimitSlider for improved user experience in setting activity limits. Update SetupDiscordShareScreen to manage personal limits and device selection more effectively. Integrate PiShockAuthDisclaimer across relevant components to clarify authentication processes. Enhance styles for better layout and responsiveness in setup screens. (287636b)
- Refactor OfficialController to integrate AppVersionBadge into the header, enhancing version display. Update styles for official header components to improve alignment and layout consistency. Introduce a new function to sanitize client location hints, ensuring only trusted data is processed. Implement clamping logic for share limits and retain server-issued share codes, improving share handling and validation in activity sharing routes. (379ba11)
- Enhance application functionality by adding a test script to package.json for improved testing capabilities. Refactor UI components to unify brand styling by replacing 'auth-boot__brand-stack' with 'auth-boot__brand-row' across multiple components. Introduce new policy validation functions in the server to enforce intensity and duration ceilings, ensuring compliance with operational limits. Update control routes to utilize the new validation logic for better error handling and response management. (36b4652)
- Implement server shutdown handling and enhance application health reporting. Introduce a graceful shutdown mechanism with a 10-second grace period in Docker configurations. Update health endpoints to reflect server status during shutdown. Refactor AppVersionBadge for improved version display and integrate server shutdown notifications in the client. Enhance styles for better UI consistency across components. (d9cec55)
- Enhance environment configuration and Docker setup for PiShock application. Update .env.example to clarify required variables and improve documentation. Refactor docker-compose files to utilize environment variables for database configuration and service health checks. Implement health checks in Dockerfile and entrypoint script to ensure required environment variables are set before starting the application. Upgrade dependencies in package.json and package-lock.json for improved stability and performance. (3b96182)
- Implement SetupDiscordShareScreen and enhance Discord sharing functionality in App component. Introduce state management for setup sharing phases and integrate error handling for share operations. Update UI to reflect new sharing options and improve user experience during setup. Refactor related components for better integration of Discord sharing features. (7057145)
- Refactor App component to enhance PiShock login flow and UI. Introduce PiShockLinkingScreen for improved user experience during login. Update AppVersionBadge integration across components for consistent version display. Enhance styles for better layout and responsiveness in authentication screens. Implement error handling in LinkConfirmPanel and LoginPanel for clearer user feedback. (47a6b72)
- Enhance versioning and environment management in the application. Introduce version.json and .env.version for version tracking. Update Dockerfile to include build arguments for Git SHA and reference details. Modify Vite configuration to load app version from version.json and expose it as an environment variable. Implement AppVersionBadge component in the client for displaying the app version. Update server health endpoint to return version information. Refactor build scripts to ensure version information is correctly written and copied to the output directories. (f7a1830)
- Implement activity location hint resolution in App component and server routes. Introduce ClientLocationHint type for enhanced location data handling. Update API requests to include location hints, improving accuracy in activity context resolution. Refactor resolveActivityLocation function to utilize client hints and cache results for efficiency. Enhance Discord location resolution logic to support both client and server data sources. (5f67dda)
- Enhance CommandLog model and logging functionality. Introduce new fields for executorLabel, source, and location details in the CommandLog schema. Update App component to include instanceId in API requests. Implement new styles for official log sources and locations in the UI. Refactor OfficialLogsPanel to display source and location information. Improve session logging to accommodate new data fields and ensure accurate logging of commands from both Discord and website sources. (e8b301d)
- Enhance Discord proxy authentication and logging features. Introduce new environment variables for managing proxy signature requirements and allow missing bot instance checks in development. Refactor App component to utilize public logs and improve real-time event handling. Update styles for official logs and participant interactions, enhancing user experience and UI consistency. Implement new consent management features in ActivityLimitsSettings and SafetyWarning components. (926241d)
- Enhance FriendsParticipantList and OfficialController components with multi-color support for user IDs. Introduce colorForUserId function to dynamically assign colors based on user IDs. Update button styles in FriendsParticipantList for multi-selection and improve visual feedback in OfficialController. Refactor multiColorForKey function for consistency in color assignment. Improve overall UI responsiveness and aesthetics. (124d469)
- Implement Discord share limits and enhance logging functionality in App component. Introduce state management for Discord share settings, allowing users to bypass limits when controlling shared shockers. Update UI components to reflect new logging features and improve overall user experience with enhanced styles for official logs and participant lists. Refactor related components for better integration of Discord functionalities. (9a122f4)
- Enhance Picture-in-Picture (PIP) functionality by adding layout management and CSS adjustments. Implement class toggling for PIP mode in App component and streamline the PipIncomingShock component for a more compact display. Update styles to support new PIP layout and improve overall UI consistency. Refactor Discord SDK integration for better layout mode handling. (0584660)
- Implement incoming command handling in App component and update related types. Refactor state management to replace PipLastCommand with lastIncoming state for better tracking of incoming shocks. Enhance DemoApp to showcase PipIncomingShock component. Update styles for new incoming shock UI elements and remove deprecated PipLastCommand component. Modify realtime event types to support incoming commands and ensure proper broadcasting of command events in the server routes. (bde237b)
- Refactor App and DemoApp components to support multi-selection of target IDs for shockers. Updated state management for selected targets and enhanced rendering logic for friend shockers. Introduced new PipLastCommandInfo type and integrated it into the App's command handling. Improved styles for official mode components and added new CSS classes for better UI presentation. (7c4425e)
- Update README.md to enhance safety warnings and provide comprehensive application details. Added critical safety information, features overview, architecture overview, and complete setup guide for the PiShock Discord Activity. (1aa2bc9)
- Update Docker publish workflow to trigger on both release and develop branches. (0fb74ff)
- Enhance share code functionality and settings management. Added support for redeeming share codes in the API and updated UI components to manage share codes and settings for shockers. Introduced state management for focused shocker settings and improved user experience in the SharesPanel and ActivityLimitsSettings components. (ed8382b)
- Refactor OfficialController and update styles for edge buttons. Introduced nudgeIntensity function for improved intensity handling and revamped styles for official panel components, enhancing layout and button interactions. (072ff4d)
- Refactor TypeScript configuration and enhance UI components. Updated tsconfig to use project references. Improved styles for slider components and added new duration presets and intensity handling in OfficialController. (3cbcd72)
- Quiet Docker publish CI annotations. (4181035)

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.0...v2.1.0

## v2.1.0 — 2026-11-15

## What's changed

### Platform
- Rebuilt as a self-hosted Discord Activity (Fastify + React + Postgres) with GHCR/Docker deploy
- Live build version badge; outdated clients are blocked until relaunch
- Click the version badge for **Latest version** + changelog
- Auto GitHub Releases on every push to `release` (`#major` / `#minor` / `#patch`)

### Controls & friends
- Official-style remote: shock / vibrate / beep, hold (tap) mode, duration presets, edge nudges
- Discord Shockers: control friends in the activity with live roster status
- Multi-shock and per-person intensity; color-coded targets and limit markers
- Owner E-STOP latch; pause sync from PiShock; share / Activity Limit ceilings enforced server-side
- PIP surface shows incoming hits (and queue next when enabled)

### Sharing & setup
- First-run setup for which shockers to share into Discord
- Per-mode Activity Limits (shock / vibrate / beep min–max intensity & duration)
- PiShock link flow with confirm, API key reveal, and rejected-key recovery
- Default start menu prompt (own hubs vs Discord Shockers)

### Command queue
- Optional owner queue: pause, halt, skip, clear, stars / stars-only access
- Real-time queue position and ETA for senders

### Mobile & Discord chrome
- Respect Discord mobile safe areas (Leave / Invite / minimize bar)
- Compact remote layout on short/narrow phones (no oversized desktop scale)

### Safety & ops
- Safety notice / consent gate; richer public command log (source & location)
- Graceful shutdown + health reporting for deploys
- Emergency-stop and hold-cancel race fixes; firmer limit enforcement

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v1.0...v2.1.0
