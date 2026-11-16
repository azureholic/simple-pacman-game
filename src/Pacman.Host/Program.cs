var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new HealthStatusResponse("ok", "static-spa", "synthetic")));
app.MapGet("/healthz", () => Results.Ok(new HealthStatusResponse("ok", "static-spa", "synthetic")));

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();

public sealed record HealthStatusResponse(string Status, string Mode, string Seed);

public partial class Program;
