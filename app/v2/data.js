/* data.js — v2 fixtures shaped like Qortex engine outputs (poster scale). */

export const DATASETS = [
  {
    id: 'ds000117', name: 'Cam-CAN', source: 'OpenNeuro', visibility: 'Public',
    subjects: 2546, ageRange: '18–88', ageMean: 32.1, sizeTB: 18.4, license: 'CC0',
    modalities: [
      { key: 'T1w', count: 2546 }, { key: 'fMRI', count: 2412 }, { key: 'dMRI', count: 1894 },
      { key: 'EEG', count: 1201 }, { key: 'MEG', count: 860 }, { key: 'More', count: 3 },
    ],
    tasks: [
      { key: 'rest', count: 1580 }, { key: 'nback', count: 1290 }, { key: 'go/no-go', count: 1103 },
      { key: 'motor', count: 876 }, { key: 'language', count: 742 }, { key: 'more', count: 12 },
    ],
    readiness: { pct: 92, passed: 412, warnings: 28, failed: 6 },
    ageHist: [40, 96, 180, 260, 330, 365, 330, 270, 210, 160, 120, 85, 55, 30, 15],
    ageBins: ['18', '23', '28', '33', '38', '43', '48', '53', '58', '63', '68', '73', '78', '83', '88'],
    sex: [{ label: 'Female', count: 1231 }, { label: 'Male', count: 1293 }, { label: 'Other', count: 22 }],
    scanners: [
      { label: 'Siemens Prisma', count: 1842 }, { label: 'Siemens Trio', count: 412 },
      { label: 'Philips Achieva', count: 174 }, { label: 'GE Discovery', count: 82 }, { label: 'Other', count: 36 },
    ],
    sites: [
      { label: 'Cambridge', count: 1102 }, { label: 'Oxford', count: 612 },
      { label: 'London', count: 324 }, { label: 'Nottingham', count: 208 }, { label: 'Other', count: 300 },
    ],
    quality: [
      { level: 'fail', msg: 'Missing events.tsv for 6 functional runs', files: 'sub-1042, sub-1187, sub-1533 …' },
      { level: 'fail', msg: 'EEG sidecar SamplingFrequency mismatch across 2 subjects', files: 'sub-0221/eeg, sub-0740/eeg' },
      { level: 'warn', msg: 'participants.tsv missing optional column "handedness" for 28 rows', files: 'participants.tsv' },
      { level: 'warn', msg: 'Inconsistent EchoTime across 14 fMRI runs (0.030 vs 0.0305)', files: 'sub-*/func/*_bold.json' },
      { level: 'pass', msg: 'BIDS 1.8.0 structural validation', files: '412 checks passed' },
      { level: 'pass', msg: 'Companion closure complete for MEG/EEG recordings', files: 'channels, coordsystem, events' },
    ],
  },
  { id: 'ds004130', name: 'Motor Imagery EEG', source: 'OpenNeuro', visibility: 'Public', subjects: 42, ageRange: '19–41', ageMean: 26.4, sizeTB: 0.03, license: 'CC0',
    modalities: [{ key: 'EEG', count: 42 }], tasks: [{ key: 'motorimagery', count: 42 }, { key: 'rest', count: 42 }],
    readiness: { pct: 78, passed: 118, warnings: 9, failed: 3 } },
  { id: 'ds002718', name: 'Left/Right Hand MI', source: 'OpenNeuro', visibility: 'Public', subjects: 65, ageRange: '20–35', ageMean: 25.1, sizeTB: 0.045, license: 'CC0',
    modalities: [{ key: 'EEG', count: 65 }], tasks: [{ key: 'motorimagery', count: 65 }],
    readiness: { pct: 84, passed: 205, warnings: 4, failed: 1 } },
  { id: 'ds000247', name: 'Resting MEG', source: 'OpenNeuro', visibility: 'Public', subjects: 19, ageRange: '21–48', ageMean: 31.0, sizeTB: 0.01, license: 'CC0',
    modalities: [{ key: 'MEG', count: 19 }], tasks: [{ key: 'rest', count: 19 }],
    readiness: { pct: 88, passed: 96, warnings: 2, failed: 0 } },
];

/* BIDS tree for ds000117 (poster subset) */
export const TREE = {
  name: 'ds000117 (Cam-CAN)', kind: 'root', children: [
    { name: 'sub-01', kind: 'dir', children: [
      { name: 'func', kind: 'dir', children: [
        { name: 'sub-01_task-rest_bold.nii.gz', kind: 'nii', size: '201.4 MB' },
        { name: 'sub-01_task-nback_bold.nii.gz', kind: 'nii', size: '188.9 MB' },
      ]},
      { name: 'anat', kind: 'dir', children: [
        { name: 'sub-01_T1w.nii.gz', kind: 'nii', size: '24.6 MB' },
        { name: 'sub-01_T2w.nii.gz', kind: 'nii', size: '22.1 MB' },
      ]},
      { name: 'dwi', kind: 'dir', children: [
        { name: 'sub-01_dwi.nii.gz', kind: 'nii', size: '312.7 MB' },
        { name: 'sub-01_dwi.json', kind: 'json', size: '2.1 KB' },
      ]},
      { name: 'eeg', kind: 'dir', children: [
        { name: 'sub-01_task-rest_eeg.set', kind: 'sig', size: '96.3 MB' },
        { name: 'sub-01_task-rest_eeg.json', kind: 'json', size: '1.4 KB' },
      ]},
      { name: 'meg', kind: 'dir', children: [
        { name: 'sub-01_task-rest_meg.fif', kind: 'sig', size: '412.0 MB' },
      ]},
    ]},
    { name: 'sub-02', kind: 'dir', children: [
      { name: 'func', kind: 'dir', children: [
        { name: 'sub-02_task-rest_bold.nii.gz', kind: 'nii', size: '198.7 MB' },
      ]},
    ]},
    { name: 'participants.tsv', kind: 'tsv', size: '148 KB' },
    { name: 'dataset_description.json', kind: 'json', size: '1.1 KB' },
  ],
};

/* metadata shown for a selected file */
export const FILE_META = {
  'sub-01_task-rest_bold.nii.gz': {
    Name: 'sub-01_task-rest_bold.nii.gz', Modality: 'func', Suffix: 'bold', Task: 'rest',
    RepetitionTime: '0.800', EchoTime: '0.030', FlipAngle: '52', MultibandAcceleration: '8',
    PhaseEncodingDirection: 'i-', Space: 'MNI152NLin6Asym', Desc: 'preproc', Size: '201.4 MB',
  },
  default: {
    Name: '—', Modality: '—', Suffix: '—', Task: '—', RepetitionTime: '—', EchoTime: '—', Size: '—',
  },
};

export const KG = {
  dataset: 'ds000117',
  modalities: ['T1w', 'fMRI', 'dMRI', 'EEG', 'MEG'],
  tasks: ['rest', 'nback', 'go/no-go', 'motor', 'language'],
  participants: ['sub-01', 'sub-02', 'sub-03', '…', 'sub-2546'],
  files: ['sub-01_T1w.nii.gz', 'sub-01_task-rest_bold.nii.gz', 'sub-01_dwi.nii.gz', 'sub-01_task-rest_eeg.set', '…'],
  edges: {
    mt: [['fMRI','rest'],['fMRI','nback'],['fMRI','go/no-go'],['fMRI','motor'],['fMRI','language'],['EEG','rest'],['EEG','motor'],['MEG','rest'],['MEG','language']],
    tp: [['rest','sub-01'],['rest','sub-02'],['nback','sub-01'],['nback','sub-03'],['go/no-go','sub-02'],['motor','sub-03'],['language','…'],['rest','sub-2546'],['motor','sub-2546']],
    pf: [['sub-01','sub-01_T1w.nii.gz'],['sub-01','sub-01_task-rest_bold.nii.gz'],['sub-01','sub-01_dwi.nii.gz'],['sub-01','sub-01_task-rest_eeg.set'],['sub-02','…'],['sub-03','…'],['…','…'],['sub-2546','…']],
  },
};

export const EEG_CHANNELS = ['Fp1','Fp2','F7','F3','Fz','F4','F8','T7','C3','Cz','C4','T8','P7','P3','Pz','P4','P8','O1','O2'];

export const PILLARS = [
  { ic: 'manifest', h: 'Semantic manifest', p: 'Understand BIDS structure and metadata at a glance.' },
  { ic: 'shield', h: 'Readiness checks', p: 'Automated BIDS validation and quality scoring.' },
  { ic: 'download', h: 'Selective download', p: 'Get only what you need. Subjects, sessions, modalities, files.' },
  { ic: 'eye', h: 'Visual audit', p: 'Inspect anatomy, function, diffusion, EEG/MEG.' },
  { ic: 'convert', h: 'Conversion', p: 'DICOM, proprietary formats, and legacy to BIDS.' },
  { ic: 'cube', h: 'ML-ready artifacts', p: 'Clean, consistent, and analysis-ready neurodata.' },
];
