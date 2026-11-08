// Respect the most specific matching agent group and longest URL rule.
export function crawlRobots(text: string, url: URL) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
    delay: number;
  }[] = [];
  let group: (typeof groups)[number] | undefined,
    directives = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line.split("#")[0]);
    if (!match) continue;
    const [, raw, value] = match,
      key = raw.toLowerCase();
    if (key === "user-agent") {
      if (!group || directives) {
        group = { agents: [], rules: [], delay: 0 };
        groups.push(group);
        directives = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      directives = true;
      if ((key === "allow" || key === "disallow") && value)
        group.rules.push({ allow: key === "allow", path: value });
      if (key === "crawl-delay" && Number.isFinite(Number(value)))
        group.delay = Math.max(0, Number(value) * 1000);
    }
  }
  const exact = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "meemai".includes(a)),
  );
  const selected = exact.length
    ? exact
    : groups.filter((g) => g.agents.includes("*"));
  const path = url.pathname + url.search;
  const matches = selected
    .flatMap((g) => g.rules)
    .filter((r) => {
      const regex = r.path
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp("^" + regex).test(path);
    })
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return {
    allowed: matches[0]?.allow !== false,
    delay: Math.max(10_000, ...selected.map((g) => g.delay)),
  };
}
