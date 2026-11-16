using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Xml.Linq;

namespace Pacman.Host.Tests;

public sealed class AcceptanceSuitesTests
{
    [Fact]
    public async Task AcceptanceHarnessSmokeScript_Passes()
    {
        var repoRoot = FindRepoRoot();
        var runnerPath = Path.Combine("tests", "acceptance", "_harness", "runner.mjs");

        var (exitCode, stdout, stderr) = await RunNodeAsync(repoRoot, [runnerPath]);

        Assert.True(exitCode == 0, $"Acceptance harness failed (exit {exitCode}):\n{stdout}\n{stderr}");
        Assert.Contains("Acceptance harness smoke test OK", stdout);
    }

    [Fact]
    public async Task AcceptanceSuites_ExecuteAccordingToPendingIssuesPolicy()
    {
        var repoRoot = FindRepoRoot();
        var acceptanceDir = Path.Combine(repoRoot, "tests", "acceptance");
        var pendingJsonPath = Path.Combine(acceptanceDir, "pending.json");

        Assert.True(File.Exists(pendingJsonPath), "Expected tests/acceptance/pending.json to exist.");

        var manifest = JsonSerializer.Deserialize<PendingAcceptanceManifest>(
            await File.ReadAllTextAsync(pendingJsonPath));
        Assert.NotNull(manifest);
        Assert.NotNull(manifest.PendingIssues);

        var pendingSet = new HashSet<string>(manifest.PendingIssues, StringComparer.Ordinal);
        foreach (var pendingIssue in pendingSet)
        {
            var pendingSuiteDir = Path.Combine(acceptanceDir, pendingIssue);
            Assert.True(
                Directory.Exists(pendingSuiteDir),
                $"Pending acceptance issue '{pendingIssue}' in pending.json has no directory at {pendingSuiteDir}.");
        }

        var suiteDirectories = Directory.GetDirectories(acceptanceDir, "ISS-*")
            .OrderBy(static d => d, StringComparer.Ordinal)
            .ToArray();

        foreach (var suiteDir in suiteDirectories)
        {
            var issueKey = Path.GetFileName(suiteDir);
            var contractPath = Path.Combine(suiteDir, "contract.md");
            Assert.True(File.Exists(contractPath), $"Expected {issueKey}/contract.md to exist.");

            var testFiles = Directory.GetFiles(suiteDir, "*.test.ts", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(suiteDir, "*.test.mjs", SearchOption.AllDirectories))
                .OrderBy(static f => f, StringComparer.Ordinal)
                .ToArray();

            if (testFiles.Length == 0)
            {
                continue;
            }

            var nodeArgs = new List<string> { "--test", "--test-reporter=junit" };
            nodeArgs.AddRange(testFiles);

            var (exitCode, stdout, stderr) = await RunNodeAsync(repoRoot, nodeArgs);
            Assert.False(
                string.IsNullOrWhiteSpace(stdout),
                $"Expected JUnit XML output from {issueKey} acceptance suite.\nStderr:\n{stderr}");

            var junitDoc = XDocument.Parse(stdout);
            var testCases = junitDoc.Descendants("testcase").ToArray();
            var errors = junitDoc.Descendants("error").ToArray();
            var failures = junitDoc.Descendants("failure").ToArray();

            Assert.NotEmpty(testCases);
            Assert.Empty(errors);

            if (pendingSet.Contains(issueKey))
            {
                foreach (var failure in failures)
                {
                    Assert.True(
                        failure.Value.Contains("AssertionError", StringComparison.Ordinal),
                        $"Pending acceptance suite {issueKey} must fail only on assertions (zero runtime errors), but got:\n{failure.Value}");
                }
            }
            else
            {
                Assert.True(
                    exitCode == 0 && failures.Length == 0,
                    $"Enforced acceptance suite {issueKey} failed (exit {exitCode}):\n{stdout}\n{stderr}");
            }
        }
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunNodeAsync(
        string workingDirectory,
        IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "node",
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        foreach (var arg in arguments)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = new Process { StartInfo = startInfo };
        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        return (process.ExitCode, await stdoutTask, await stderrTask);
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

    private sealed class PendingAcceptanceManifest
    {
        [JsonPropertyName("pendingIssues")]
        public List<string>? PendingIssues { get; init; }
    }
}
