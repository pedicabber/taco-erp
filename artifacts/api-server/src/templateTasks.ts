export interface TemplateSub {
  title: string;
}

export interface TemplateTask {
  title: string;
  subtasks: TemplateSub[];
}

export const TEMPLATE_TASKS: TemplateTask[] = [
  {
    title: "Project Kickoff & Requirements",
    subtasks: [
      { title: "Review quote and scope" },
      { title: "Identify system requirements" },
      { title: "Identify customer constraints" },
      { title: "Request sample materials" },
      { title: "Assign engineering owner" },
    ],
  },
  {
    title: "System Architecture Design",
    subtasks: [
      { title: "Define overall system concept" },
      { title: "Define material flow sequence" },
      { title: "Select robot model and configuration" },
      { title: "Define station layout concept" },
      { title: "Identify key risks and challenges" },
    ],
  },
  {
    title: "Mechanical System Design",
    subtasks: [
      { title: "Create full system layout CAD" },
      { title: "Design base frame and structure" },
      { title: "Design robot mounting and reach envelope" },
      { title: "Design guarding integration" },
      { title: "Review for manufacturability" },
    ],
  },
  {
    title: "EOAT (End of Arm Tool) Engineering",
    subtasks: [
      { title: "Define handling requirements (weight, size, material)" },
      { title: "Select vacuum method and components" },
      { title: "Design EOAT structure" },
      { title: "Validate reach and payload limits" },
      { title: "Finalize EOAT design for build" },
    ],
  },
  {
    title: "Electrical System Design",
    subtasks: [
      { title: "Define IO list (inputs/outputs)" },
      { title: "Select PLC hardware" },
      { title: "Define network architecture" },
      { title: "Create electrical schematics" },
      { title: "Design control panel layout" },
    ],
  },
  {
    title: "Controls Architecture Planning",
    subtasks: [
      { title: "Define PLC structure and standards" },
      { title: "Define robot-control interface" },
      { title: "Define safety architecture" },
      { title: "Define alarm and fault structure" },
      { title: "Define data tracking requirements" },
    ],
  },
  {
    title: "HMI / User Interface Design",
    subtasks: [
      { title: "Define operator workflows" },
      { title: "Design screen layouts" },
      { title: "Define alarm displays" },
      { title: "Define user access levels" },
      { title: "Review usability with team" },
    ],
  },
  {
    title: "Bill of Materials (BOM)",
    subtasks: [
      { title: "Generate mechanical BOM" },
      { title: "Generate electrical BOM" },
      { title: "Generate purchased components list" },
      { title: "Review long lead items" },
      { title: "Release BOM to purchasing" },
    ],
  },
  {
    title: "Critical Design Review (CDR)",
    subtasks: [
      { title: "Prepare design package" },
      { title: "Internal engineering review" },
      { title: "Customer design review meeting" },
      { title: "Capture required changes" },
      { title: "Final design approval" },
    ],
  },
  {
    title: "Release to Manufacturing",
    subtasks: [
      { title: "Finalize all drawings" },
      { title: "Finalize schematics" },
      { title: "Release revision-controlled packages" },
      { title: "Handoff meeting with shop and controls" },
    ],
  },
];
