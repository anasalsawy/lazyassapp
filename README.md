# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Linting notes (restricted environments)

If your environment cannot install npm packages (for example, registry access is blocked), the lint guard will skip ESLint and exit successfully. In normal dev/CI environments with dependencies installed, `npm run lint` executes ESLint as usual.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## OSS staging (no prod risk checklist)

### Run staging locally (frontend)
1. Copy the staging env template and edit as needed:
   ```sh
   cp .env.staging.example .env.staging
   ```
2. Start the Vite dev server with staging env:
   ```sh
   npm run dev -- --mode staging
   ```

### Run oss-runner locally
```sh
cd services/oss-runner
node index.js
```

### Confirm production is untouched
- The default provider remains `cloud` (`VITE_AUTOBUY_PROVIDER=cloud`), so existing Browser Use Cloud flows are unchanged.
- Staging uses `VITE_AUTOBUY_PROVIDER=oss` and points to `VITE_OSS_RUNNER_URL`.
- No production deployment configs were modified.

### Deploy staging separately
- Use a preview deployment or a dedicated staging subdomain (e.g., `staging.yourdomain.com`) with the staging env variables:
  - `AUTOBUY_PROVIDER=oss` (feature flag)
  - `VITE_AUTOBUY_PROVIDER=oss` (frontend consumption)
  - `VITE_OSS_RUNNER_URL=https://<your-oss-runner-host>`
