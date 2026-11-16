using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Pacman.Host.Tests;

public sealed partial class StaticSpaAndHealthTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/healthz")]
    public async Task HealthEndpoints_Return200OkWithSyntheticStaticMetadata(string endpoint)
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(endpoint);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<HealthStatusResponse>();
        Assert.NotNull(payload);
        Assert.Equal("ok", payload.Status);
        Assert.Equal("static-spa", payload.Mode);
        Assert.Equal("synthetic", payload.Seed);
    }

    [Fact]
    public async Task IndexRoute_ServesStaticReactSpaHtmlAndCompiledAssets()
    {
        using var client = factory.CreateClient();

        using var indexResponse = await client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, indexResponse.StatusCode);
        Assert.Equal("text/html", indexResponse.Content.Headers.ContentType?.MediaType);

        var html = await indexResponse.Content.ReadAsStringAsync();
        Assert.Contains("<title>Simple Pacman</title>", html);
        Assert.Contains("<div id=\"root\"></div>", html);

        var scriptMatch = ScriptAssetRegex().Match(html);
        Assert.True(scriptMatch.Success, "Expected compiled JS bundle script tag in static index.html.");

        var assetPath = "/" + scriptMatch.Groups[1].Value.TrimStart('.', '/');
        using var scriptResponse = await client.GetAsync(assetPath);
        Assert.Equal(HttpStatusCode.OK, scriptResponse.StatusCode);

        var scriptBody = await scriptResponse.Content.ReadAsStringAsync();
        Assert.Contains("Simple Pacman", scriptBody);
    }

    [Fact]
    public void StaticDistOutput_ContainsStandaloneAssets()
    {
        var repoRoot = FindRepoRoot();
        var distDir = Path.Combine(repoRoot, "web", "dist");

        Assert.True(File.Exists(Path.Combine(distDir, "index.html")), "Expected web/dist/index.html to exist.");
        Assert.True(File.Exists(Path.Combine(distDir, "health.json")), "Expected web/dist/health.json to exist.");

        var assetsDir = Path.Combine(distDir, "assets");
        Assert.True(Directory.Exists(assetsDir), "Expected web/dist/assets directory to exist.");
        Assert.NotEmpty(Directory.GetFiles(assetsDir, "*.js"));
        Assert.NotEmpty(Directory.GetFiles(assetsDir, "*.css"));
    }

    [Fact]
    public async Task FrontendTestSuite_Passes()
    {
        var repoRoot = FindRepoRoot();
        var webDir = Path.Combine(repoRoot, "web");
        var npmCmd = OperatingSystem.IsWindows() ? "cmd.exe" : "npm";
        var npmArguments = OperatingSystem.IsWindows() ? "/d /c npm.cmd test" : "test";

        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = npmCmd,
                Arguments = npmArguments,
                WorkingDirectory = webDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            },
        };

        process.Start();
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        Assert.True(process.ExitCode == 0, $"Frontend tests failed (exit {process.ExitCode}):\n{stdout}\n{stderr}");
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "SimplePacman.slnx")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("Could not locate repository root.");
    }

    [GeneratedRegex("src=\"([^\"]*assets/[^\"]+\\.js)\"")]
    private static partial Regex ScriptAssetRegex();
}
