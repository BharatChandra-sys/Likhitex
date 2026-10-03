import os, re, json

ROOTS = ["frontend/app", "frontend/components"]
files = []
for root in ROOTS:
    for dirpath, _, names in os.walk(root):
        if "node_modules" in dirpath: continue
        for n in names:
            if n.endswith((".tsx", ".ts")):
                files.append(os.path.join(dirpath, n).replace("\\", "/"))

# A JSX element that renders a control. We look at the opening tag only.
TAG = re.compile(r"<(button|a|Link|input|select|textarea)\b((?:[^<>{}]|\{[^{}]*\})*?)(/?)>", re.S)
ACTIVE = re.compile(r"\bon(?:Click|Change|Submit|Input|KeyDown|Blur|Focus)\s*=|href\s*=|type\s*=\s*[\"']submit|action\s*=")

dead = []
total = 0
for f in files:
    src = open(f, encoding="utf-8").read()
    # strip comments so commented-out markup is not counted
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    for m in TAG.finditer(src):
        tag, attrs, selfclose = m.group(1), m.group(2), m.group(3)
        if tag == "Link" and "href" not in attrs: continue
        total += 1
        if not ACTIVE.search(attrs):
            line = src[:m.start()].count("\n") + 1
            dead.append({"file": f, "line": line, "tag": tag,
                         "label": re.sub(r"\s+", " ", attrs)[:110]})

print(json.dumps({"total_controls": total, "dead": dead}, indent=1))

