import type { NextConfig } from "next";
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  serverExternalPackages: ['bcryptjs'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
