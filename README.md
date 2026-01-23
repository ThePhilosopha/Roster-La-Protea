# Protea Roster

A React application for managing the Protea Ridge Roster.

## Getting Started

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Run the development server:
    ```bash
    npm run dev
    ```

## Building for Production

To create a production build:

```bash
npm run build
```

The output will be in the `dist` directory.

## Deployment

### Deploying to Vercel

This project is ready to be deployed on [Vercel](https://vercel.com).

1.  **Push to GitHub**: Ensure your project is pushed to a GitHub repository.
2.  **Import to Vercel**:
    *   Go to your Vercel dashboard.
    *   Click "Add New..." -> "Project".
    *   Select your GitHub repository.
3.  **Configure Project**:
    *   Framework Preset: Vite
    *   Build Command: `npm run build`
    *   Output Directory: `dist`
    *   (Optional) If you have environment variables, add them in the "Environment Variables" section.
4.  **Deploy**: Click "Deploy".

Vercel will automatically detect the configuration and deploy your application. The `vercel.json` file included in this repository ensures that client-side routing works correctly.
