FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Preserve full monorepo-relative structure so server.js resolves node_modules correctly
COPY --chown=nextjs:nodejs .next/standalone ./
COPY --chown=nextjs:nodejs .next/static ./packages/demo-site/.next/static
COPY --chown=nextjs:nodejs public ./packages/demo-site/public

USER nextjs
WORKDIR /app/packages/demo-site
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
