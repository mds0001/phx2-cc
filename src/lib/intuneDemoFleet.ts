/**
 * Built-in simulated Intune fleet — used when an Intune connection's
 * Tenant ID is the literal string "demo". Lets the whole pipeline
 * (source read -> signature matching -> research queue -> mapping ->
 * Ivanti hydration) run end-to-end with no Graph tenant.
 *
 * The detected-app strings are deliberately authentic ARP/MSI debris:
 * redistributables, runtimes, updaters and vendor components mixed in
 * with the flagship titles a customer actually buys.
 */

export const DEMO_TENANT = "demo";

interface DemoDeviceRecord {
  id: string;
  deviceName: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  operatingSystem: string;
  osVersion: string;
  userPrincipalName: string;
  userDisplayName: string;
  emailAddress: string;
  complianceState: string;
  managedDeviceOwnerType: string;
  enrolledDateTime: string;
  lastSyncDateTime: string;
  totalStorageSpaceInBytes: number;
  freeStorageSpaceInBytes: number;
  wiFiMacAddress: string;
  ethernetMacAddress: string;
  azureADDeviceId: string;
}

interface DemoApp {
  displayName: string;
  publisher: string;
  version: string;
}

export interface DemoDevice {
  device: DemoDeviceRecord;
  apps: DemoApp[];
}

const GB = 1024 ** 3;

const app = (displayName: string, publisher: string, version: string): DemoApp =>
  ({ displayName, publisher, version });

// ── Shared debris pools (what real Windows fleets look like) ───────────────

const WINDOWS_BASELINE: DemoApp[] = [
  app("Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135", "Microsoft Corporation", "14.38.33135.0"),
  app("Microsoft Visual C++ 2015-2022 Redistributable (x86) - 14.38.33135", "Microsoft Corporation", "14.38.33135.0"),
  app("Microsoft Visual C++ 2013 Redistributable (x64) - 12.0.40664", "Microsoft Corporation", "12.0.40664.0"),
  app("Microsoft Edge", "Microsoft Corporation", "126.0.2592.87"),
  app("Microsoft Edge WebView2 Runtime", "Microsoft Corporation", "126.0.2592.87"),
  app("Microsoft .NET Runtime - 8.0.6 (x64)", "Microsoft Corporation", "8.0.6.33814"),
  app("Microsoft Windows Desktop Runtime - 8.0.6 (x64)", "Microsoft Corporation", "8.0.6.33814"),
  app("Microsoft OneDrive", "Microsoft Corporation", "24.101.0519.0003"),
  app("Microsoft Update Health Tools", "Microsoft Corporation", "5.72.0.0"),
];

const M365: DemoApp[] = [
  app("Microsoft 365 Apps for enterprise - en-us", "Microsoft Corporation", "16.0.17628.20144"),
  app("Microsoft Teams", "Microsoft Corporation", "24124.2315.2911.3357"),
  app("Teams Machine-Wide Installer", "Microsoft Corporation", "1.6.00.4472"),
];

const DELL_TOOLS: DemoApp[] = [
  app("Dell Command | Update for Windows Universal", "Dell Inc.", "5.1.0"),
  app("Dell SupportAssist", "Dell Inc.", "3.14.2.24851"),
  app("Dell SupportAssist OS Recovery Plugin for Dell Update", "Dell Inc.", "5.5.5.16247"),
];

const CHROME: DemoApp[] = [
  app("Google Chrome", "Google LLC", "126.0.6478.127"),
  app("Google Update Helper", "Google LLC", "1.3.36.352"),
];

// ── The fleet ───────────────────────────────────────────────────────────────

export const DEMO_DEVICES: DemoDevice[] = [
  {
    device: {
      id: "demo-0001",
      deviceName: "DEMO-LT-JSMITH",
      serialNumber: "DEMO4X1KQ2",
      manufacturer: "Dell Inc.",
      model: "Latitude 5440",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "jsmith@demo.local",
      userDisplayName: "Jane Smith",
      emailAddress: "jsmith@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-09-12T14:03:22Z",
      lastSyncDateTime: "2026-07-07T06:41:09Z",
      totalStorageSpaceInBytes: 512 * GB,
      freeStorageSpaceInBytes: 288 * GB,
      wiFiMacAddress: "A4B1C2D3E401",
      ethernetMacAddress: "A4B1C2D3E402",
      azureADDeviceId: "aadid-demo-0001",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...DELL_TOOLS, ...CHROME,
      app("Adobe Acrobat Reader", "Adobe Inc.", "24.002.20857"),
      app("Zoom Workplace (64-bit)", "Zoom Video Communications, Inc.", "6.0.11"),
      app("7-Zip 23.01 (x64)", "Igor Pavlov", "23.01"),
      app("Intel(R) Graphics Driver", "Intel Corporation", "31.0.101.5333"),
    ],
  },
  {
    device: {
      id: "demo-0002",
      deviceName: "DEMO-WS-CAD01",
      serialNumber: "DEMO7P3RT8",
      manufacturer: "Dell Inc.",
      model: "Precision 3680",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "mchen@demo.local",
      userDisplayName: "Ming Chen",
      emailAddress: "mchen@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-06-02T09:12:44Z",
      lastSyncDateTime: "2026-07-07T05:58:31Z",
      totalStorageSpaceInBytes: 1024 * GB,
      freeStorageSpaceInBytes: 410 * GB,
      wiFiMacAddress: "A4B1C2D3E411",
      ethernetMacAddress: "A4B1C2D3E412",
      azureADDeviceId: "aadid-demo-0002",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...DELL_TOOLS, ...CHROME,
      app("AutoCAD 2024 - English", "Autodesk", "24.3.61.0"),
      app("Autodesk Material Library 2024", "Autodesk", "24.1.0.31"),
      app("Autodesk Material Library Base Resolution Image Library 2024", "Autodesk", "24.1.0.31"),
      app("Autodesk Desktop App", "Autodesk, Inc.", "7.6.1.61"),
      app("Autodesk Single Sign On Component", "Autodesk", "13.7.5.1747"),
      app("Autodesk Access", "Autodesk", "2.4.0.1121"),
      app("Autodesk Genuine Service", "Autodesk", "4.1.6.2379"),
      app("NVIDIA Graphics Driver 552.44", "NVIDIA Corporation", "552.44"),
      app("Adobe Acrobat (64-bit)", "Adobe Inc.", "24.002.20857"),
    ],
  },
  {
    device: {
      id: "demo-0003",
      deviceName: "DEMO-LT-DEV01",
      serialNumber: "DEMO2K8WM5",
      manufacturer: "LENOVO",
      model: "ThinkPad T14 Gen 4",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "apatel@demo.local",
      userDisplayName: "Aisha Patel",
      emailAddress: "apatel@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-11-20T16:47:10Z",
      lastSyncDateTime: "2026-07-06T22:15:03Z",
      totalStorageSpaceInBytes: 512 * GB,
      freeStorageSpaceInBytes: 96 * GB,
      wiFiMacAddress: "A4B1C2D3E421",
      ethernetMacAddress: "A4B1C2D3E422",
      azureADDeviceId: "aadid-demo-0003",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...CHROME,
      app("Lenovo System Update", "Lenovo", "5.08.02.25"),
      app("Microsoft Visual Studio Code (User)", "Microsoft Corporation", "1.90.2"),
      app("Git", "The Git Development Community", "2.45.2"),
      app("Node.js", "Node.js Foundation", "20.14.0"),
      app("Docker Desktop", "Docker Inc.", "4.31.1"),
      app("Notepad++ (64-bit x64)", "Notepad++ Team", "8.6.8"),
      app("PuTTY release 0.81 (64-bit)", "Simon Tatham", "0.81.0.0"),
      app("WinSCP 6.3.4", "Martin Prikryl", "6.3.4"),
    ],
  },
  {
    device: {
      id: "demo-0004",
      deviceName: "DEMO-LT-FIN02",
      serialNumber: "DEMO9C4VB1",
      manufacturer: "HP",
      model: "EliteBook 840 G10",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3593",
      userPrincipalName: "rgarcia@demo.local",
      userDisplayName: "Rosa Garcia",
      emailAddress: "rgarcia@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-08-14T11:29:55Z",
      lastSyncDateTime: "2026-07-07T07:02:47Z",
      totalStorageSpaceInBytes: 512 * GB,
      freeStorageSpaceInBytes: 201 * GB,
      wiFiMacAddress: "A4B1C2D3E431",
      ethernetMacAddress: "A4B1C2D3E432",
      azureADDeviceId: "aadid-demo-0004",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...CHROME,
      app("HP Support Assistant", "HP Inc.", "9.24.5.15"),
      app("Adobe Acrobat (64-bit)", "Adobe Inc.", "24.002.20857"),
      app("Sage 50 Accounting 2024", "Sage Software, Inc.", "31.1.0.87"),
      app("TeamViewer", "TeamViewer", "15.55.3"),
      app("Zoom Workplace (64-bit)", "Zoom Video Communications, Inc.", "6.0.11"),
    ],
  },
  {
    device: {
      id: "demo-0005",
      deviceName: "DEMO-SF-EXEC1",
      serialNumber: "DEMO5T7NH3",
      manufacturer: "Microsoft Corporation",
      model: "Surface Laptop 5",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "dwallace@demo.local",
      userDisplayName: "Dan Wallace",
      emailAddress: "dwallace@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-05-30T08:05:19Z",
      lastSyncDateTime: "2026-07-07T04:33:52Z",
      totalStorageSpaceInBytes: 256 * GB,
      freeStorageSpaceInBytes: 88 * GB,
      wiFiMacAddress: "A4B1C2D3E441",
      ethernetMacAddress: "A4B1C2D3E442",
      azureADDeviceId: "aadid-demo-0005",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...CHROME,
      app("Zoom Workplace (64-bit)", "Zoom Video Communications, Inc.", "6.0.11"),
      app("Adobe Acrobat Reader", "Adobe Inc.", "24.002.20857"),
      app("Slack", "Slack Technologies Inc.", "4.39.90"),
    ],
  },
  {
    device: {
      id: "demo-0006",
      deviceName: "DEMO-DT-MKT03",
      serialNumber: "DEMO1M6QL9",
      manufacturer: "Dell Inc.",
      model: "OptiPlex 7010",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "kjones@demo.local",
      userDisplayName: "Kim Jones",
      emailAddress: "kjones@demo.local",
      complianceState: "noncompliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-07-22T13:44:02Z",
      lastSyncDateTime: "2026-07-05T19:27:36Z",
      totalStorageSpaceInBytes: 1024 * GB,
      freeStorageSpaceInBytes: 655 * GB,
      wiFiMacAddress: "A4B1C2D3E451",
      ethernetMacAddress: "A4B1C2D3E452",
      azureADDeviceId: "aadid-demo-0006",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...DELL_TOOLS, ...CHROME,
      app("Adobe Creative Cloud", "Adobe Inc.", "6.1.0.587"),
      app("Adobe Photoshop 2024", "Adobe Inc.", "25.9.1"),
      app("Adobe Illustrator 2024", "Adobe Inc.", "28.5.0"),
      app("Adobe Genuine Service", "Adobe Inc.", "8.2.0.53"),
      app("Camtasia 2023", "TechSmith Corporation", "23.4.1.53340"),
      app("VLC media player", "VideoLAN", "3.0.21"),
    ],
  },
  {
    device: {
      id: "demo-0007",
      deviceName: "DEMO-LT-SALES4",
      serialNumber: "DEMO8R2XZ6",
      manufacturer: "Dell Inc.",
      model: "Latitude 5440",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3447",
      userPrincipalName: "tnguyen@demo.local",
      userDisplayName: "Tuan Nguyen",
      emailAddress: "tnguyen@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-10-08T10:18:37Z",
      lastSyncDateTime: "2026-07-07T03:12:58Z",
      totalStorageSpaceInBytes: 256 * GB,
      freeStorageSpaceInBytes: 74 * GB,
      wiFiMacAddress: "A4B1C2D3E461",
      ethernetMacAddress: "A4B1C2D3E462",
      azureADDeviceId: "aadid-demo-0007",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...DELL_TOOLS, ...CHROME,
      app("Zoom Workplace (64-bit)", "Zoom Video Communications, Inc.", "6.0.11"),
      app("Slack", "Slack Technologies Inc.", "4.39.90"),
      app("Adobe Acrobat Reader", "Adobe Inc.", "24.002.20857"),
    ],
  },
  {
    device: {
      id: "demo-0008",
      deviceName: "DEMO-WS-ENG02",
      serialNumber: "DEMO3J9FD4",
      manufacturer: "LENOVO",
      model: "ThinkStation P360",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "bkowalski@demo.local",
      userDisplayName: "Beata Kowalski",
      emailAddress: "bkowalski@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-04-17T15:56:23Z",
      lastSyncDateTime: "2026-07-06T23:48:15Z",
      totalStorageSpaceInBytes: 2048 * GB,
      freeStorageSpaceInBytes: 1210 * GB,
      wiFiMacAddress: "A4B1C2D3E471",
      ethernetMacAddress: "A4B1C2D3E472",
      azureADDeviceId: "aadid-demo-0008",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...CHROME,
      app("Lenovo System Update", "Lenovo", "5.08.02.25"),
      app("AutoCAD 2024 - English", "Autodesk", "24.3.61.0"),
      app("Autodesk Material Library 2024", "Autodesk", "24.1.0.31"),
      app("Autodesk Desktop App", "Autodesk, Inc.", "7.6.1.61"),
      app("Autodesk Single Sign On Component", "Autodesk", "13.7.5.1747"),
      app("NVIDIA Graphics Driver 552.44", "NVIDIA Corporation", "552.44"),
      app("SOLIDWORKS 2024 SP3.0", "Dassault Systemes SolidWorks Corp", "32.130.0031"),
      app("SOLIDWORKS 2024 Installation Manager", "Dassault Systemes SolidWorks Corp", "32.130.0031"),
    ],
  },
  {
    device: {
      id: "demo-0009",
      deviceName: "DEMO-LT-IT01",
      serialNumber: "DEMO6W5GY7",
      manufacturer: "Dell Inc.",
      model: "Latitude 7440",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3737",
      userPrincipalName: "sadmin@demo.local",
      userDisplayName: "Sam Adminson",
      emailAddress: "sadmin@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2025-03-11T09:37:41Z",
      lastSyncDateTime: "2026-07-07T06:59:22Z",
      totalStorageSpaceInBytes: 512 * GB,
      freeStorageSpaceInBytes: 143 * GB,
      wiFiMacAddress: "A4B1C2D3E481",
      ethernetMacAddress: "A4B1C2D3E482",
      azureADDeviceId: "aadid-demo-0009",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...DELL_TOOLS, ...CHROME,
      app("Microsoft SQL Server Management Studio - 19.3", "Microsoft Corporation", "19.3.4.0"),
      app("Microsoft Visual Studio Code (User)", "Microsoft Corporation", "1.90.2"),
      app("PuTTY release 0.81 (64-bit)", "Simon Tatham", "0.81.0.0"),
      app("WinSCP 6.3.4", "Martin Prikryl", "6.3.4"),
      app("TeamViewer", "TeamViewer", "15.55.3"),
      app("Wireshark 4.2.5 x64", "The Wireshark developer community", "4.2.5"),
      app("7-Zip 23.01 (x64)", "Igor Pavlov", "23.01"),
    ],
  },
  {
    device: {
      id: "demo-0010",
      deviceName: "DEMO-LT-HR01",
      serialNumber: "DEMO0B8SC2",
      manufacturer: "HP",
      model: "ProBook 450 G10",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.3296",
      userPrincipalName: "lbrown@demo.local",
      userDisplayName: "Lena Brown",
      emailAddress: "lbrown@demo.local",
      complianceState: "compliant",
      managedDeviceOwnerType: "company",
      enrolledDateTime: "2026-01-09T12:22:18Z",
      lastSyncDateTime: "2026-07-06T18:05:44Z",
      totalStorageSpaceInBytes: 256 * GB,
      freeStorageSpaceInBytes: 119 * GB,
      wiFiMacAddress: "A4B1C2D3E491",
      ethernetMacAddress: "A4B1C2D3E492",
      azureADDeviceId: "aadid-demo-0010",
    },
    apps: [
      ...WINDOWS_BASELINE, ...M365, ...CHROME,
      app("HP Support Assistant", "HP Inc.", "9.24.5.15"),
      app("Adobe Acrobat Reader", "Adobe Inc.", "24.002.20857"),
      app("Zoom Workplace (64-bit)", "Zoom Video Communications, Inc.", "6.0.11"),
      app("Mozilla Firefox (x64 en-US)", "Mozilla", "127.0.2"),
      app("Mozilla Maintenance Service", "Mozilla", "127.0.2"),
    ],
  },
];
