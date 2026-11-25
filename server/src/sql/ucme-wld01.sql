WITH calendar_range AS (
    SELECT
        COUNT(*) FILTER (
            WHERE EXTRACT(
                ISODOW FROM (
                    $1::timestamptz
                    + g.day_offset * INTERVAL '1 day'
                )
            ) BETWEEN 1 AND 5
        )::integer AS production_days,

        COUNT(*)::integer AS calendar_days

    FROM generate_series(
        0,
        CEIL(
            EXTRACT(
                EPOCH FROM (
                    $2::timestamptz
                    - $1::timestamptz
                )
            ) / 86400.0
        )::integer - 1
    ) AS g(day_offset)
),

ordered AS (
    SELECT
        inspection_datetime,
        cycle_time,
        LEAD(inspection_datetime) OVER (
            ORDER BY inspection_datetime
        ) AS next_start

    FROM inspection

    WHERE (inspection_datetime AT TIME ZONE 'Asia/Shanghai') BETWEEN $1::timestamptz AND $2::timestamptz
),

idle AS (
    SELECT
        c.production_days AS production_days,
        COUNT(o.inspection_datetime) AS record_count,
        COALESCE(SUM(o.cycle_time), 0) AS total_runtime_seconds,
        COALESCE(
            SUM(
                CASE
                    WHEN o.next_start IS NOT NULL
                     AND EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            -
                            (
                                o.inspection_datetime
                                + o.cycle_time * INTERVAL '1 second'
                            )
                        )
                     ) = 0 * 3600
                    THEN EXTRACT(
                        EPOCH FROM (
                            o.next_start
                            -
                            (
                                o.inspection_datetime
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

    GROUP BY
        c.production_days
),

availability AS (
    SELECT
        CASE
            WHEN COUNT(o.inspection_datetime) = 0 THEN NULL
            ELSE
                GREATEST(
                    0,
                    (
                        c.calendar_days * 8 * 3600
                        -
                        COALESCE(
                            SUM(
                                CASE
                                    WHEN o.next_start IS NOT NULL
                                     AND EXTRACT(
                                        EPOCH FROM (
                                            o.next_start
                                            -
                                            (
                                                o.inspection_datetime
                                                + (
                                                    o.cycle_time || ' seconds'
                                                  )::interval
                                            )
                                        )
                                     ) = 0 * 3600
                                    THEN EXTRACT(
                                        EPOCH FROM (
                                            o.next_start
                                            -
                                            (
                                                o.inspection_datetime
                                                + (
                                                    o.cycle_time || ' seconds'
                                                  )::interval
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
                    NULLIF(
                        c.calendar_days * 8 * 3600,
                        0
                    )
                )
        END AS availability

    FROM ordered o

    CROSS JOIN calendar_range c

    GROUP BY
        c.calendar_days
),

pass_fail_counts AS (
    SELECT
        type,
        part_no,
        COUNT(*) AS total_count,
        SUM(cycle_time) AS total_runtime

    FROM inspection

    WHERE
        (inspection_datetime AT TIME ZONE 'Asia/Shanghai') BETWEEN $1::timestamptz AND $2::timestamptz
        AND type IS NOT NULL
        AND type ~ '^[A-Za-z0-9 _()./-]+$'
        AND part_no IS NOT NULL
        AND cycle_time IS NOT NULL
        AND cycle_time > 0

    GROUP BY
        type,
        part_no

    HAVING
        COUNT(*) >= 5
),

ideal_times AS (
    SELECT
        type,
        part_no,
        AVG(cycle_time) AS ideal_cycle_time

    FROM (
        SELECT
            type,
            part_no,
            cycle_time,

            ROW_NUMBER() OVER (
                PARTITION BY type, part_no
                ORDER BY cycle_time ASC
            ) AS row_num

        FROM inspection

        WHERE
            type IS NOT NULL
            AND type ~ '^[A-Za-z0-9 _()./-]+$'
            AND part_no IS NOT NULL
            AND cycle_time IS NOT NULL
            AND cycle_time > 0
    ) ranks

    -- WHERE row_num <= 10
    -- leave it out, use global average as estimate

    GROUP BY
        type,
        part_no
),

performance AS (
    SELECT
        CASE
            WHEN SUM(it.ideal_cycle_time * pfc.total_count) IS NULL
            THEN NULL
            ELSE LEAST(
                SUM(it.ideal_cycle_time * pfc.total_count)::DECIMAL
                / SUM(pfc.total_runtime), 1)
        END AS performance

    FROM pass_fail_counts pfc

    LEFT JOIN ideal_times it
        ON pfc.type = it.type
        AND pfc.part_no = it.part_no

    WHERE
        it.ideal_cycle_time IS NOT NULL
),

quality AS (
    SELECT
        COUNT(*) FILTER (WHERE inspection_result = 'Pass')::DECIMAL
        / NULLIF(COUNT(*) FILTER (WHERE inspection_result IN ('Pass', 'Fail')), 0) 
        AS quality

    FROM inspection

    WHERE
        (inspection_datetime AT TIME ZONE 'Asia/Shanghai') BETWEEN $1::timestamptz AND $2::timestamptz
        AND type IS NOT NULL
        AND type ~ '^[A-Za-z0-9 _()./-]+$'
)

SELECT
    'UCME' AS site,
    'WELDMENT INSPECTION' AS equipment,
    'UCME-WLD-01' AS equipment_id,
    'Inspection' AS equipment_type,
    a.availability * 100 AS availability,
    p.performance * 100 AS performance,
    q.quality * 100 AS quality,
    (a.availability * p.performance * q.quality) * 100 AS oee,
    CASE
        WHEN i.record_count = 0 THEN NULL
        ELSE
            (i.total_runtime_seconds::DECIMAL
            / NULLIF(i.production_days * 8 * 3600, 0)) * 100
    END AS utilization

FROM availability a

CROSS JOIN performance p
CROSS JOIN quality q
CROSS JOIN idle i;
