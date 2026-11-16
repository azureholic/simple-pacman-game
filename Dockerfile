# Stage 1: Build standalone React + TypeScript + Vite static assets
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Publish minimal static-asset preview host (no game backend logic)
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS dotnet-build
WORKDIR /src
COPY Directory.Build.props SimplePacman.slnx ./
COPY src/Pacman.Host/Pacman.Host.csproj ./src/Pacman.Host/
RUN dotnet restore src/Pacman.Host/Pacman.Host.csproj
COPY src/Pacman.Host/ ./src/Pacman.Host/
RUN dotnet publish src/Pacman.Host/Pacman.Host.csproj -c Release -o /app/publish -p:SkipSpaBuild=true

# Stage 3: Runtime container serving static assets and /health on port 8080
FROM mcr.microsoft.com/dotnet/aspnet:11.0 AS final
WORKDIR /app
COPY --from=dotnet-build /app/publish ./
COPY --from=web-build /web/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Pacman.Host.dll"]
