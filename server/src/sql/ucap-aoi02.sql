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
        start_datetime,
        cycle_time,
        LEAD(start_datetime) OVER (
            ORDER BY start_datetime
        ) AS next_start
    FROM aoi02_inspection
    WHERE (start_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
),

idle AS (
    SELECT
        c.production_days,
        COUNT(o.start_datetime) AS record_count,
        COALESCE(
            SUM(o.cycle_time),
            0
        ) AS total_runtime_seconds,
        COALESCE(
            SUM(
                CASE
                    WHEN o.next_start IS NOT NULL
                     AND EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            - (
                                o.start_datetime
                                + o.cycle_time * INTERVAL '1 second'
                            )
                        )
                     ) = 0
                    THEN EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            - (
                                o.start_datetime
                                + o.cycle_time * INTERVAL '1 second'
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
    GROUP BY c.production_days
),

availability AS (
    SELECT
        CASE
            WHEN COUNT(o.start_datetime) = 0 THEN NULL
            ELSE
                GREATEST(
                    0,
                    c.calendar_days * 8 * 3600
                    - COALESCE(
                        SUM(
                            CASE
                                WHEN o.next_start IS NOT NULL
                                 AND EXTRACT(
                                    EPOCH FROM (
                                        o.next_start
                                        - (
                                            o.start_datetime
                                            + o.cycle_time * INTERVAL '1 second'
                                        )
                                    )
                                 ) = 0 * 3600
                                THEN EXTRACT(
                                    EPOCH FROM (
                                        o.next_start
                                        - (
                                            o.start_datetime
                                            + o.cycle_time * INTERVAL '1 second'
                                        )
                                    )
                                )
                                ELSE 0
                            END
                        ),
                        0
                    )
                )::DECIMAL
                / NULLIF(
                    c.calendar_days * 8 * 3600,
                    0
                )
        END AS availability
    FROM ordered o
    CROSS JOIN calendar_range c
    GROUP BY c.calendar_days
),

inspection_counts AS (
    SELECT
        gas_panel,
        COUNT(*) AS total_count,
        SUM(cycle_time) AS total_runtime
    FROM aoi02_inspection
    WHERE
        (start_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
        AND cycle_time IS NOT NULL
        AND cycle_time > 0
    GROUP BY gas_panel
),

ideal_times AS (
    SELECT
        gas_panel,
        AVG(cycle_time) AS ideal_cycle_time
    FROM (
        SELECT
            gas_panel,
            cycle_time,
            ROW_NUMBER() OVER (
                PARTITION BY gas_panel
                ORDER BY cycle_time ASC
            ) AS rn
        FROM aoi02_inspection
        WHERE
            cycle_time IS NOT NULL
            AND cycle_time > 0
    ) t
    GROUP BY gas_panel
),

perf AS (
    SELECT
        CASE
            WHEN SUM(IT.ideal_cycle_time * IC.total_count) IS NULL
            THEN NULL
            ELSE LEAST(
                SUM(IT.ideal_cycle_time * IC.total_count)::DECIMAL
                / SUM(IC.total_runtime), 1)
        END AS performance

    FROM inspection_counts IC

    LEFT JOIN ideal_times IT
        ON IC.gas_panel = IT.gas_panel
),

quality AS (
    SELECT
        (
            COUNT(*)
            - COUNT(*) FILTER (
                WHERE D.result = 'FAILED'
                   OR D.overwrite = 'Approved'
            )
        )::DECIMAL
        / NULLIF(
            COUNT(*),
            0
        ) AS quality
    FROM aoi02_inspection_detail D
    LEFT JOIN aoi02_inspection I
        ON D.inspection_id = I.unique_id
    WHERE (I.start_datetime) BETWEEN $1::timestamptz AND $2::timestamptz
)

SELECT
    'UCAP' AS site,
    'GAS PANEL AOI' AS equipment,
    'SINAOI02' AS equipment_id,
    'Inspection' AS equipment_type,
    a.availability * 100 AS availability,
    p.performance * 100 AS performance,
    q.quality * 100 AS quality,
    (a.availability * p.performance * q.quality) * 100 AS oee,
    CASE
        WHEN i.record_count = 0 THEN NULL
        ELSE
            (
                i.total_runtime_seconds::DECIMAL
                / NULLIF(
                    i.production_days * 8 * 3600,
                    0
                )
            ) * 100
    END AS utilization
FROM availability a
CROSS JOIN perf p
CROSS JOIN quality q
CROSS JOIN idle i;
