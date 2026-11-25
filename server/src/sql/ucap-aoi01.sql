WITH calendar_range AS (
    SELECT
        COUNT(*) FILTER (
            WHERE EXTRACT(ISODOW FROM g.day) BETWEEN 1 AND 5
        )::integer AS production_days,

        COUNT(*)::integer AS calendar_days

    FROM generate_series(
        DATE($1::timestamptz AT TIME ZONE 'Singapore'),
        DATE($2::timestamptz AT TIME ZONE 'Singapore'),
        INTERVAL '1 day'
    ) AS g(day)
),

ordered AS (
    SELECT
        inspection_datetime,
        time_cost,
        LEAD(inspection_datetime) OVER (
            ORDER BY inspection_datetime
        ) AS next_start

    FROM inspection

    WHERE
        (inspection_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
),

idle AS (
    SELECT
        c.production_days AS production_days,
        COUNT(o.inspection_datetime) AS record_count,
        COALESCE(SUM(o.time_cost), 0) AS total_runtime_seconds,
        COALESCE(
            SUM(
                CASE
                    WHEN o.next_start IS NOT NULL
                     AND EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            - (
                                o.inspection_datetime
                                + o.time_cost * INTERVAL '1 second'
                            )
                        )
                     ) = 0 * 3600
                    THEN EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            - (
                                o.inspection_datetime
                                + o.time_cost * INTERVAL '1 second'
                            )
                        )
                    )
                    ELSE 0
                END
            ),
            0
        ) AS total_downtime_seconds

    FROM ordered o

    CROSS JOIN calendar_range c

    GROUP BY
        c.production_days
),

avai AS (
    SELECT
        CASE
            WHEN COUNT(o.inspection_datetime) = 0
                THEN NULL
            ELSE
                GREATEST(
                    0,
                    (
                        (c.calendar_days * 8 * 3600)
                        -
                        COALESCE(
                            SUM(
                                CASE
                                    WHEN o.next_start IS NOT NULL
                                     AND EXTRACT(
                                        EPOCH FROM (
                                            o.next_start
                                            - (
                                                o.inspection_datetime
                                                + (o.time_cost || ' seconds')::interval
                                            )
                                        )
                                     ) = 0 * 3600
                                    THEN EXTRACT(
                                        EPOCH FROM (
                                            o.next_start
                                            - (
                                                o.inspection_datetime
                                                + (o.time_cost || ' seconds')::interval
                                            )
                                        )
                                    )
                                    ELSE 0
                                END
                            ),
                            0
                        )
                    )::DECIMAL
                    /
                    NULLIF(c.calendar_days * 8 * 3600, 0)
                )
        END AS availability

    FROM ordered o

    CROSS JOIN calendar_range c

    GROUP BY
        c.calendar_days
),

ranked_cycles AS (
    SELECT
        model,
        time_cost,

        ROW_NUMBER() OVER (
            PARTITION BY model
            ORDER BY time_cost ASC
        ) AS rn

    FROM inspection

    WHERE
        model IS NOT NULL
        AND time_cost IS NOT NULL
        AND time_cost > 0
),

ideal_cycle AS (
    SELECT
        model,
        AVG(time_cost) AS ideal_cycle_time

    FROM ranked_cycles

    GROUP BY
        model
),

actual_output AS (
    SELECT
        model,
        COUNT(*) AS total_count,
        SUM(time_cost) AS total_runtime

    FROM inspection

    WHERE
        (inspection_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
        AND model IS NOT NULL
        AND time_cost IS NOT NULL
        AND time_cost > 0

    GROUP BY
        model
),

perf AS (
    SELECT
        CASE
            WHEN SUM(i.ideal_cycle_time * a.total_count) IS NULL
            THEN NULL
            ELSE LEAST(
                SUM(i.ideal_cycle_time * a.total_count)::DECIMAL
                / SUM(a.total_runtime), 1)
        END AS performance

    FROM actual_output a

    LEFT JOIN ideal_cycle i
        ON i.model = a.model
),

qty AS (
    SELECT
        (COUNT(*) FILTER (WHERE D.result = 'Pass' AND D.overwrite != 'Approve by OPERATOR')::DECIMAL
        / NULLIF(COUNT(*), 0)
        ) AS quality

    FROM inspection_detail AS D

    LEFT JOIN inspection AS I
        USING (inspection_id)

    WHERE
        (I.inspection_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
        AND I.model IS NOT NULL
)

SELECT
    'UCAP' AS site,
    'POWER BOX AOI' AS equipment,
    'SINAOI01' AS equipment_id,
    'Inspection' As equipment_type,
    a.availability * 100 AS availability,
    p.performance * 100 AS performance,
    q.quality * 100 AS quality,
    (a.availability * p.performance * q.quality) * 100 AS oee,
    /* Utilization = Runtime / Planned Production Time */
    CASE
        WHEN i.record_count = 0
            THEN NULL
        ELSE
            (i.total_runtime_seconds::DECIMAL
            / NULLIF(i.production_days * 8 * 3600, 0)) * 100
    END AS utilization

FROM avai a

CROSS JOIN perf p
CROSS JOIN qty q
CROSS JOIN idle i;
