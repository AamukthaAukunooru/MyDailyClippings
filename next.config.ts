import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/mydailyclippings',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
