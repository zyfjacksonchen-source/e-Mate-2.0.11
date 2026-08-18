"""Canonical project and sub-account ownership rules.

This module owns the SQL semantics for dated handover windows. It deliberately
does not import ``models`` or Flask so every API, report, export and MCP query
can share the same rules without creating a circular dependency.
"""

from __future__ import annotations

from datetime import date


HANDOVER_TARGET_OPERATOR = "operator"
HANDOVER_TARGET_SELF = "self"
HANDOVER_SELF_LABEL = "自运营"


def handover_active_clause(alias: str, date_expr: str) -> str:
    start_expr = f"date(COALESCE(NULLIF({alias}.start_date, ''), {alias}.handover_time))"
    end_expr = f"NULLIF({alias}.end_date, '')"
    return (
        f"COALESCE({alias}.superseded_by, 0) = 0 "
        f"AND {start_expr} <= date({date_expr}) "
        f"AND ({end_expr} IS NULL OR date({end_expr}) >= date({date_expr}))"
    )


def handover_order(alias: str) -> str:
    return (
        f"date(COALESCE(NULLIF({alias}.start_date, ''), {alias}.handover_time)) DESC, "
        f"{alias}.handover_time DESC, {alias}.id DESC"
    )


def handover_ascending_order(alias: str) -> str:
    return (
        f"date(COALESCE(NULLIF({alias}.start_date, ''), {alias}.handover_time)) ASC, "
        f"{alias}.handover_time ASC, {alias}.id ASC"
    )


def project_base_target_expr(*, project_alias: str = "p") -> str:
    """Return the target type that applied before any dated handover window.

    ``projects.operation_mode`` is kept as a current-state compatibility field
    and is mutated by open-ended handovers. Once history exists, the first
    handover's source is the stable evidence for the pre-handover baseline.
    """
    return f"""COALESCE((
        SELECT CASE WHEN ph0.from_operator_id IS NULL
                    THEN '{HANDOVER_TARGET_SELF}'
                    ELSE '{HANDOVER_TARGET_OPERATOR}' END
        FROM project_handovers ph0
        WHERE ph0.project_id = {project_alias}.id
        ORDER BY {handover_ascending_order("ph0")} LIMIT 1
    ), COALESCE({project_alias}.operation_mode, '{HANDOVER_TARGET_OPERATOR}'))"""


def sub_account_project_expr(
    date_expr: str,
    *,
    sub_account_alias: str = "sa",
) -> str:
    """Return the project that owned a sub-account on a given date."""
    active = handover_active_clause("sahp", date_expr)
    return f"""COALESCE((
        SELECT NULLIF(sahp.project_id, 0) FROM sub_account_handovers sahp
        WHERE sahp.sub_account_id = {sub_account_alias}.id AND {active}
        ORDER BY {handover_order("sahp")} LIMIT 1
    ), (
        SELECT NULLIF(sahp0.from_project_id, 0) FROM sub_account_handovers sahp0
        WHERE sahp0.sub_account_id = {sub_account_alias}.id
          AND COALESCE(sahp0.superseded_by, 0) = 0
          AND COALESCE(sahp0.from_project_id, 0) != 0
        ORDER BY {handover_ascending_order("sahp0")} LIMIT 1
    ), {sub_account_alias}.project_id)"""


def sub_account_target_expr(
    date_expr: str,
    *,
    sub_account_alias: str = "sa",
    project_alias: str = "p",
) -> str:
    sub_active = handover_active_clause("sah", date_expr)
    project_active = handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT sah.to_target_type FROM sub_account_handovers sah
        WHERE sah.sub_account_id = {sub_account_alias}.id AND {sub_active}
        ORDER BY {handover_order("sah")} LIMIT 1
    ), (
        SELECT ph.to_target_type FROM project_handovers ph
        WHERE ph.project_id = {project_alias}.id AND {project_active}
        ORDER BY {handover_order("ph")} LIMIT 1
    ), {project_base_target_expr(project_alias=project_alias)})"""


def sub_account_operator_expr(
    date_expr: str,
    *,
    sub_account_alias: str = "sa",
    project_alias: str = "p",
) -> str:
    sub_active = handover_active_clause("sah", date_expr)
    project_active = handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT sah.to_operator_id FROM sub_account_handovers sah
        WHERE sah.sub_account_id = {sub_account_alias}.id AND {sub_active}
        ORDER BY {handover_order("sah")} LIMIT 1
    ), (
        SELECT ph.to_operator_id FROM project_handovers ph
        WHERE ph.project_id = {project_alias}.id AND {project_active}
        ORDER BY {handover_order("ph")} LIMIT 1
    ), (SELECT ph0.from_operator_id FROM project_handovers ph0
        WHERE ph0.project_id = {project_alias}.id
        ORDER BY {handover_ascending_order("ph0")} LIMIT 1
    ), {project_alias}.operator_id)"""


def project_target_expr(date_expr: str, *, project_alias: str = "p") -> str:
    project_active = handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT ph.to_target_type FROM project_handovers ph
        WHERE ph.project_id = {project_alias}.id AND {project_active}
        ORDER BY {handover_order("ph")} LIMIT 1
    ), {project_base_target_expr(project_alias=project_alias)})"""


def project_operator_expr(date_expr: str, *, project_alias: str = "p") -> str:
    project_active = handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT ph.to_operator_id FROM project_handovers ph
        WHERE ph.project_id = {project_alias}.id AND {project_active}
        ORDER BY {handover_order("ph")} LIMIT 1
    ), (SELECT ph0.from_operator_id FROM project_handovers ph0
        WHERE ph0.project_id = {project_alias}.id
        ORDER BY {handover_ascending_order("ph0")} LIMIT 1
    ), {project_alias}.operator_id)"""


def effective_operator_filter(
    date_expr: str,
    operator_id=None,
    department=None,
    filter_operator_id=None,
    *,
    sub_account_alias: str = "sa",
    project_alias: str = "p",
) -> tuple[list[str], list, str]:
    target_expr = sub_account_target_expr(
        date_expr,
        sub_account_alias=sub_account_alias,
        project_alias=project_alias,
    )
    operator_expr = sub_account_operator_expr(
        date_expr,
        sub_account_alias=sub_account_alias,
        project_alias=project_alias,
    )
    clauses = [f"{target_expr} != ?"]
    params = [HANDOVER_TARGET_SELF]
    if operator_id:
        clauses.append(f"{operator_expr} = ?")
        params.append(operator_id)
    elif department:
        clauses.append(f"{operator_expr} IN (SELECT id FROM users WHERE department = ?)")
        params.append(department)
    if filter_operator_id:
        clauses.append(f"{operator_expr} = ?")
        params.append(filter_operator_id)
    return clauses, params, operator_expr


def project_visibility_clause(
    date_expr: str,
    *,
    operator_id=None,
    department=None,
    project_alias: str = "p",
    sub_account_alias: str = "sa",
) -> tuple[str, list]:
    """Return one project-level clause including child-account ownership."""
    if not operator_id and not department:
        return "", []
    project_target = project_target_expr(date_expr, project_alias=project_alias)
    project_operator = project_operator_expr(date_expr, project_alias=project_alias)
    sub_target = sub_account_target_expr(
        date_expr,
        sub_account_alias=sub_account_alias,
        project_alias=project_alias,
    )
    sub_operator = sub_account_operator_expr(
        date_expr,
        sub_account_alias=sub_account_alias,
        project_alias=project_alias,
    )
    sub_project = sub_account_project_expr(
        date_expr,
        sub_account_alias=sub_account_alias,
    )
    if operator_id:
        return (
            f"""(({project_target} != ? AND {project_operator} = ?)
                 OR EXISTS (
                    SELECT 1 FROM sub_accounts {sub_account_alias}
                    WHERE {sub_project} = {project_alias}.id
                      AND {sub_target} != ?
                      AND {sub_operator} = ?
                 ))""",
            [HANDOVER_TARGET_SELF, operator_id, HANDOVER_TARGET_SELF, operator_id],
        )
    return (
        f"""(({project_target} != ? AND {project_operator} IN (SELECT id FROM users WHERE department = ?))
             OR EXISTS (
                SELECT 1 FROM sub_accounts {sub_account_alias}
                WHERE {sub_project} = {project_alias}.id
                  AND {sub_target} != ?
                  AND {sub_operator} IN (SELECT id FROM users WHERE department = ?)
             ))""",
        [HANDOVER_TARGET_SELF, department, HANDOVER_TARGET_SELF, department],
    )


def _date_expr(as_of_date=None) -> str:
    if as_of_date in (None, ""):
        return "date('now','localtime')"
    try:
        normalized = date.fromisoformat(str(as_of_date)[:10]).isoformat()
    except (TypeError, ValueError) as exc:
        raise ValueError("归属日期格式无效") from exc
    return f"'{normalized}'"


def _active_handover_id_expr(
    table: str,
    alias: str,
    owner_column: str,
    owner_expr: str,
    date_expr: str,
) -> str:
    active = handover_active_clause(alias, date_expr)
    return f"""(
        SELECT {alias}.id FROM {table} {alias}
        WHERE {alias}.{owner_column} = {owner_expr} AND {active}
        ORDER BY {handover_order(alias)} LIMIT 1
    )"""


def resolve_project_ownership(conn, project_id: int, as_of_date=None):
    """Return one project ownership fact for a date, including its source."""
    date_expr = _date_expr(as_of_date)
    target_expr = project_target_expr(date_expr)
    operator_expr = project_operator_expr(date_expr)
    handover_id_expr = _active_handover_id_expr(
        "project_handovers", "ph", "project_id", "p.id", date_expr
    )
    row = conn.execute(
        f"""SELECT facts.*, u.real_name AS current_operator_name,
                         u.department AS current_department
            FROM (
                SELECT p.*,
                       p.operator_id AS base_operator_id,
                       {target_expr} AS current_target_type,
                       CASE WHEN {target_expr} = '{HANDOVER_TARGET_SELF}'
                            THEN NULL ELSE {operator_expr} END AS current_operator_id,
                       {handover_id_expr} AS project_handover_id,
                       CASE WHEN {handover_id_expr} IS NOT NULL
                            THEN 'project_handover' ELSE 'project_base' END AS ownership_source,
                       date({date_expr}) AS ownership_date
                FROM projects p
                WHERE p.id = ?
            ) facts
            LEFT JOIN users u ON u.id = facts.current_operator_id""",
        (project_id,),
    ).fetchone()
    if not row:
        return None
    fact = dict(row)
    fact["is_self_operated"] = fact.get("current_target_type") == HANDOVER_TARGET_SELF
    fact["is_visible"] = not fact["is_self_operated"]
    return fact


def resolve_sub_account_ownership(conn, sub_account_id: int, as_of_date=None):
    """Return one sub-account ownership fact with sub-account override precedence."""
    date_expr = _date_expr(as_of_date)
    project_expr = sub_account_project_expr(date_expr)
    target_expr = sub_account_target_expr(date_expr)
    operator_expr = sub_account_operator_expr(date_expr)
    sub_handover_id_expr = _active_handover_id_expr(
        "sub_account_handovers", "sah", "sub_account_id", "sa.id", date_expr
    )
    project_handover_id_expr = _active_handover_id_expr(
        "project_handovers", "ph", "project_id", "p.id", date_expr
    )
    row = conn.execute(
        f"""SELECT facts.*, u.real_name AS current_operator_name,
                         u.department AS current_department
            FROM (
                SELECT sa.*,
                       {project_expr} AS effective_project_id,
                       p.project_name,
                       p.operator_id AS base_operator_id,
                       {target_expr} AS current_target_type,
                       CASE WHEN {target_expr} = '{HANDOVER_TARGET_SELF}'
                            THEN NULL ELSE {operator_expr} END AS current_operator_id,
                       {sub_handover_id_expr} AS sub_account_handover_id,
                       {project_handover_id_expr} AS project_handover_id,
                       CASE WHEN {sub_handover_id_expr} IS NOT NULL THEN 'sub_account_handover'
                            WHEN {project_handover_id_expr} IS NOT NULL THEN 'project_handover'
                            ELSE 'project_base' END AS ownership_source,
                       date({date_expr}) AS ownership_date
                FROM sub_accounts sa
                JOIN projects p ON p.id = {project_expr}
                WHERE sa.id = ?
            ) facts
            LEFT JOIN users u ON u.id = facts.current_operator_id""",
        (sub_account_id,),
    ).fetchone()
    if not row:
        return None
    fact = dict(row)
    fact["project_id"] = fact.get("effective_project_id")
    fact["is_self_operated"] = fact.get("current_target_type") == HANDOVER_TARGET_SELF
    fact["is_visible"] = not fact["is_self_operated"]
    return fact


def resolve_sub_account_project_id(conn, sub_account_id: int, as_of_date=None):
    """Resolve only the dated project id without loading ownership metadata."""
    date_expr = _date_expr(as_of_date)
    project_expr = sub_account_project_expr(date_expr)
    row = conn.execute(
        f"""SELECT {project_expr} AS project_id
            FROM sub_accounts sa
            WHERE sa.id = ?""",
        (sub_account_id,),
    ).fetchone()
    return int(row["project_id"]) if row and row["project_id"] is not None else None
