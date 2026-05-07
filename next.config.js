/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium"], 
  },
  webpack: (config, { isserver }) => {
    if( isserver ) {
        config.externals.push("@sparticuz/chromium");
    }
      return config:
  },
};

module.exports = nextConfig;
