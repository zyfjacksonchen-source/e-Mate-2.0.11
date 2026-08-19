# @e-mate/dsh-plugin-find-skill

This package preinstalls the pinned e-Mate adaptation of `dsh-find-skill`. The Agent uses DSH's native Skill registry, Tool events, User Questions, session scope, and subprocess service to search skills.sh, request installation consent, and install the selected Skill.

The official `skills` CLI is pinned to `1.5.22` and runs through Desktop's packaged `pnpm`; `latest` is never resolved during a 2.0.10 run. The four e-Mate connector Skills resolve from the immutable `skills-v2.0.9` Git tag.
