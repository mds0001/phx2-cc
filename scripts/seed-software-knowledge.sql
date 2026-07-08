-- Starter pack for the software normalization knowledge layer.
-- Idempotent: catalog rows dedupe on the case-insensitive identity index;
-- signatures dedupe on (publisher, name_pattern).
-- Run on dev first; replay on prod at go-live.

-- ── Catalog: canonical products ─────────────────────────────────────────────
insert into public.software_catalog (manufacturer, title, version, edition, licensable, notes)
values
  ('Microsoft',         '365 Apps for enterprise',        null,   null, true,  'starter pack'),
  ('Microsoft',         'Visual Studio Code',             null,   null, false, 'starter pack — free'),
  ('Microsoft',         'SQL Server Management Studio',   null,   null, false, 'starter pack — free'),
  ('Adobe',             'Acrobat',                        null,   null, true,  'starter pack'),
  ('Adobe',             'Acrobat Reader',                 null,   null, false, 'starter pack — free'),
  ('Adobe',             'Creative Cloud',                 null,   null, true,  'starter pack'),
  ('Adobe',             'Photoshop',                      '2024', null, true,  'starter pack'),
  ('Adobe',             'Illustrator',                    '2024', null, true,  'starter pack'),
  ('Autodesk',          'AutoCAD',                        '2024', null, true,  'starter pack'),
  ('Google',            'Chrome',                         null,   null, false, 'starter pack — free'),
  ('Zoom',              'Zoom Workplace',                 null,   null, true,  'starter pack'),
  ('TechSmith',         'Camtasia',                       '2023', null, true,  'starter pack'),
  ('TeamViewer',        'TeamViewer',                     null,   null, true,  'starter pack'),
  ('Igor Pavlov',       '7-Zip',                          null,   null, false, 'starter pack — free'),
  ('Notepad++ Team',    'Notepad++',                      null,   null, false, 'starter pack — free'),
  ('Mozilla',           'Firefox',                        null,   null, false, 'starter pack — free'),
  ('Slack',             'Slack',                          null,   null, true,  'starter pack'),
  ('Sage',              '50 Accounting',                  '2024', null, true,  'starter pack'),
  ('Dassault Systemes', 'SOLIDWORKS',                     '2024', null, true,  'starter pack')
on conflict do nothing;

-- ── Signatures ──────────────────────────────────────────────────────────────
-- verdict noise         -> suppressed install debris (no catalog link)
-- verdict product       -> the string IS the catalog product
-- verdict component_of  -> debris that evidences the catalog product
insert into public.software_signatures
  (publisher, name_pattern, verdict, catalog_id, status, source, reason, confidence)
select
  s.publisher,
  s.name_pattern,
  s.verdict,
  case when s.cat_title is null then null else (
    select c.id from public.software_catalog c
    where lower(c.manufacturer) = lower(s.cat_mfr)
      and lower(c.title) = lower(s.cat_title)
      and coalesce(lower(c.version), '') = coalesce(lower(s.cat_version), '')
    limit 1
  ) end,
  'active', 'manual', 'starter pack', 1.0
from (values
  -- Windows / Microsoft debris
  ('Microsoft Corporation', 'Microsoft Visual C++%Redistributable%',    'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft .NET%Runtime%',                  'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft .NET Framework%',                'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft Windows Desktop Runtime%',       'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft Edge%',                          'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft OneDrive',                       'noise',        null, null, null),
  ('Microsoft Corporation', 'Microsoft Update Health Tools',            'noise',        null, null, null),
  -- Vendor update/support tooling
  ('Google LLC',            'Google Update Helper',                     'noise',        null, null, null),
  ('Adobe Inc.',            'Adobe Genuine Service',                    'noise',        null, null, null),
  ('Adobe Inc.',            'Adobe Refresh Manager',                    'noise',        null, null, null),
  ('Dell Inc.',             'Dell Command%',                            'noise',        null, null, null),
  ('Dell Inc.',             'Dell SupportAssist%',                      'noise',        null, null, null),
  ('Lenovo',                'Lenovo System Update',                     'noise',        null, null, null),
  ('HP Inc.',               'HP Support Assistant',                     'noise',        null, null, null),
  ('Mozilla',               'Mozilla Maintenance Service',              'noise',        null, null, null),
  (null,                    'Autodesk Desktop App',                     'noise',        null, null, null),
  (null,                    'Autodesk Single Sign On Component',        'noise',        null, null, null),
  (null,                    'Autodesk Access',                          'noise',        null, null, null),
  (null,                    'Autodesk Genuine Service',                 'noise',        null, null, null),
  -- Drivers
  (null,                    'NVIDIA%',                                  'noise',        null, null, null),
  (null,                    'Intel(R)%',                                'noise',        null, null, null),
  (null,                    'Realtek%',                                 'noise',        null, null, null),
  -- Components that evidence a product
  ('Microsoft Corporation', 'Microsoft Teams%',                         'component_of', 'Microsoft', '365 Apps for enterprise', null),
  ('Microsoft Corporation', 'Teams Machine-Wide Installer',             'component_of', 'Microsoft', '365 Apps for enterprise', null),
  (null,                    'Autodesk Material Library%',               'component_of', 'Autodesk', 'AutoCAD', '2024'),
  ('Dassault Systemes SolidWorks Corp', 'SOLIDWORKS 2024 Installation Manager', 'component_of', 'Dassault Systemes', 'SOLIDWORKS', '2024'),
  -- Products
  ('Microsoft Corporation', 'Microsoft 365 Apps for enterprise%',       'product', 'Microsoft', '365 Apps for enterprise', null),
  ('Microsoft Corporation', 'Microsoft Visual Studio Code%',            'product', 'Microsoft', 'Visual Studio Code', null),
  ('Microsoft Corporation', 'Microsoft SQL Server Management Studio%',  'product', 'Microsoft', 'SQL Server Management Studio', null),
  ('Adobe Inc.',            'Adobe Acrobat Reader%',                    'product', 'Adobe', 'Acrobat Reader', null),
  ('Adobe Inc.',            'Adobe Acrobat%',                           'product', 'Adobe', 'Acrobat', null),
  ('Adobe Inc.',            'Adobe Creative Cloud',                     'product', 'Adobe', 'Creative Cloud', null),
  ('Adobe Inc.',            'Adobe Photoshop 2024',                     'product', 'Adobe', 'Photoshop', '2024'),
  ('Adobe Inc.',            'Adobe Illustrator 2024',                   'product', 'Adobe', 'Illustrator', '2024'),
  ('Autodesk',              'AutoCAD 2024%',                            'product', 'Autodesk', 'AutoCAD', '2024'),
  ('Google LLC',            'Google Chrome',                            'product', 'Google', 'Chrome', null),
  ('Zoom Video Communications, Inc.', 'Zoom Workplace%',                'product', 'Zoom', 'Zoom Workplace', null),
  ('TechSmith Corporation', 'Camtasia%',                                'product', 'TechSmith', 'Camtasia', '2023'),
  ('TeamViewer',            'TeamViewer%',                              'product', 'TeamViewer', 'TeamViewer', null),
  ('Igor Pavlov',           '7-Zip%',                                   'product', 'Igor Pavlov', '7-Zip', null),
  ('Notepad++ Team',        'Notepad++%',                               'product', 'Notepad++ Team', 'Notepad++', null),
  ('Mozilla',               'Mozilla Firefox%',                         'product', 'Mozilla', 'Firefox', null),
  ('Slack Technologies Inc.', 'Slack',                                  'product', 'Slack', 'Slack', null),
  ('Sage Software, Inc.',   'Sage 50 Accounting%',                      'product', 'Sage', '50 Accounting', '2024'),
  ('Dassault Systemes SolidWorks Corp', 'SOLIDWORKS 2024 SP%',          'product', 'Dassault Systemes', 'SOLIDWORKS', '2024')
) as s(publisher, name_pattern, verdict, cat_mfr, cat_title, cat_version)
where not exists (
  select 1 from public.software_signatures x
  where x.name_pattern = s.name_pattern
    and coalesce(x.publisher, '') = coalesce(s.publisher, '')
);
