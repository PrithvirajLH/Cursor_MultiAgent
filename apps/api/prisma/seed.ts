import {
  AccessLevel,
  MessageType,
  PrismaClient,
  TeamRole,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  UserRole
} from '@prisma/client';

const prisma = new PrismaClient();

function getDepartmentCode(teamName: string | null) {
  if (!teamName) {
    return 'NA';
  }
  const words = teamName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return 'NA';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function buildDisplayId(teamName: string | null, createdAt: Date, ticketNumber: number) {
  const yyyy = createdAt.getFullYear();
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  const dd = String(createdAt.getDate()).padStart(2, '0');
  const sequence = String(ticketNumber).padStart(3, '0');
  return `${getDepartmentCode(teamName)}_${yyyy}${mm}${dd}_${sequence}`;
}

async function seedMinimal() {
  await prisma.ticketAccess.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.user.deleteMany();
  await prisma.routingRule.deleteMany();
  await prisma.team.deleteMany();
  await prisma.category.deleteMany();

  const aiTeam = await prisma.team.create({
    data: { name: 'AI', slug: 'ai', description: 'AI support team' }
  });

  await prisma.user.createMany({
    data: [
      {
        email: 'jane.doe@company.com',
        displayName: 'Jane Doe',
        role: UserRole.EMPLOYEE,
        department: 'Finance',
        location: 'Remote'
      },
      {
        email: 'alex.park@company.com',
        displayName: 'Alex Park',
        role: UserRole.AGENT,
        department: 'AI',
        location: 'Remote'
      },
      {
        email: 'maria.chen@company.com',
        displayName: 'Maria Chen',
        role: UserRole.LEAD,
        department: 'AI',
        location: 'Remote'
      },
      {
        email: 'sam.rivera@company.com',
        displayName: 'Sam Rivera',
        role: UserRole.TEAM_ADMIN,
        department: 'AI',
        location: 'Remote'
      },
      {
        email: 'owner@company.com',
        displayName: 'Owner',
        role: UserRole.OWNER,
        department: null,
        location: 'Remote'
      }
    ]
  });

  const users = await prisma.user.findMany({
    where: { email: { in: ['alex.park@company.com', 'maria.chen@company.com', 'sam.rivera@company.com'] } }
  });
  const samUser = await prisma.user.findUnique({ where: { email: 'sam.rivera@company.com' } });
  if (samUser) {
    await prisma.user.update({
      where: { id: samUser.id },
      data: { primaryTeamId: aiTeam.id }
    });
  }

  const roleByEmail = new Map([
    ['alex.park@company.com', TeamRole.AGENT],
    ['maria.chen@company.com', TeamRole.LEAD],
    ['sam.rivera@company.com', TeamRole.ADMIN]
  ]);

  await prisma.teamMember.createMany({
    data: users.map((user) => ({
      teamId: aiTeam.id,
      userId: user.id,
      role: roleByEmail.get(user.email) ?? TeamRole.AGENT
    }))
  });
}

async function seedDev() {
  const teams = [
    { name: 'IT Service Desk', slug: 'it-service-desk', description: 'Devices, access, core systems' },
    { name: 'HR Operations', slug: 'hr-operations', description: 'People ops, onboarding, payroll' },
    { name: 'AI', slug: 'ai', description: 'AI tooling, models, data requests' },
    { name: 'Medicaid Pending', slug: 'medicaid-pending', description: 'Eligibility, claims, approvals' },
    { name: 'White Gloves', slug: 'white-gloves', description: 'Executive and VIP support' }
  ];

  const teamRecords = [] as { id: string; slug: string; name: string }[];
  for (const team of teams) {
    const record = await prisma.team.upsert({
      where: { slug: team.slug },
      update: { name: team.name, description: team.description },
      create: team
    });
    teamRecords.push({ id: record.id, slug: record.slug, name: record.name });
  }

  const categorySeeds = [
    { name: 'Access & Identity', slug: 'access-identity', description: 'SSO, VPN, permissions' },
    { name: 'Hardware & Devices', slug: 'hardware-devices', description: 'Laptops, peripherals' },
    { name: 'HR Operations', slug: 'hr-ops', description: 'People ops and onboarding' }
  ];

  const categoryRecords = [] as { id: string; slug: string }[];
  for (const category of categorySeeds) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, description: category.description },
      create: category
    });
    categoryRecords.push({ id: record.id, slug: record.slug });
  }

  const hrCategory = categoryRecords.find((category) => category.slug === 'hr-ops');
  if (hrCategory) {
    await prisma.category.upsert({
      where: { slug: 'hr-onboarding' },
      update: { name: 'Onboarding', description: 'New hire onboarding', parentId: hrCategory.id },
      create: {
        name: 'Onboarding',
        slug: 'hr-onboarding',
        description: 'New hire onboarding',
        parentId: hrCategory.id
      }
    });
  }

  const users = [
    {
      email: 'jane.doe@company.com',
      displayName: 'Jane Doe',
      department: 'Finance',
      location: 'New York, NY',
      role: UserRole.EMPLOYEE
    },
    {
      email: 'alex.park@company.com',
      displayName: 'Alex Park',
      department: 'IT',
      location: 'Remote',
      role: UserRole.AGENT
    },
    {
      email: 'maria.chen@company.com',
      displayName: 'Maria Chen',
      department: 'HR',
      location: 'Chicago, IL',
      role: UserRole.LEAD
    },
    {
      email: 'sam.rivera@company.com',
      displayName: 'Sam Rivera',
      department: 'AI',
      location: 'Austin, TX',
      role: UserRole.TEAM_ADMIN
    },
    {
      email: 'owner@company.com',
      displayName: 'Owner',
      department: null,
      location: 'Remote',
      role: UserRole.OWNER
    }
  ];

  const userRecords = [] as { id: string; email: string }[];
  for (const user of users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: user
    });
    userRecords.push({ id: record.id, email: record.email });
  }

  const jane = userRecords.find((user) => user.email === 'jane.doe@company.com');
  const alex = userRecords.find((user) => user.email === 'alex.park@company.com');
  const maria = userRecords.find((user) => user.email === 'maria.chen@company.com');
  const sam = userRecords.find((user) => user.email === 'sam.rivera@company.com');
  const ownerUser = userRecords.find((user) => user.email === 'owner@company.com');

  if (!jane || !alex || !maria || !sam || !ownerUser) {
    throw new Error('Seed users missing');
  }

  const itTeam = teamRecords.find((team) => team.slug === 'it-service-desk');
  const hrTeam = teamRecords.find((team) => team.slug === 'hr-operations');
  const aiTeam = teamRecords.find((team) => team.slug === 'ai');
  const medicaidTeam = teamRecords.find((team) => team.slug === 'medicaid-pending');
  const vipTeam = teamRecords.find((team) => team.slug === 'white-gloves');

  if (!itTeam || !hrTeam || !aiTeam || !medicaidTeam || !vipTeam) {
    throw new Error('Seed teams missing');
  }

  await prisma.user.update({
    where: { id: sam.id },
    data: { primaryTeamId: aiTeam.id }
  });

  await prisma.user.update({
    where: { id: maria.id },
    data: { primaryTeamId: hrTeam.id }
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: itTeam.id, userId: alex.id } },
    update: { role: TeamRole.AGENT },
    create: { teamId: itTeam.id, userId: alex.id, role: TeamRole.AGENT }
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: hrTeam.id, userId: maria.id } },
    update: { role: TeamRole.LEAD },
    create: { teamId: hrTeam.id, userId: maria.id, role: TeamRole.LEAD }
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: aiTeam.id, userId: sam.id } },
    update: { role: TeamRole.ADMIN },
    create: { teamId: aiTeam.id, userId: sam.id, role: TeamRole.ADMIN }
  });
  // OWNER has no team membership; TEAM_ADMIN (Sam) has primaryTeamId set above

  await prisma.routingRule.createMany({
    data: [
      {
        name: 'HR onboarding and benefits',
        teamId: hrTeam.id,
        keywords: ['hr', 'onboard', 'benefits'],
        priority: 10,
        isActive: true
      },
      {
        name: 'IT access and devices',
        teamId: itTeam.id,
        keywords: ['vpn', 'laptop', 'device', 'it'],
        priority: 20,
        isActive: true
      }
    ],
    skipDuplicates: true
  });

  const now = new Date();
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  const seedPrefix = '[Seed]';

  const existingSeed = await prisma.ticket.count({
    where: { subject: { startsWith: seedPrefix } }
  });

  const teamNameById = new Map(teamRecords.map((team) => [team.id, team.name]));

  if (existingSeed > 0) {
    const missingDisplayId = await prisma.ticket.findMany({
      where: { displayId: null },
      include: { assignedTeam: true }
    });
    for (const ticket of missingDisplayId) {
      const displayId = buildDisplayId(ticket.assignedTeam?.name ?? null, ticket.createdAt, ticket.number);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { displayId }
      });
    }
    return;
  }

  const accessCategory = categoryRecords.find((category) => category.slug === 'access-identity');
  const hardwareCategory = categoryRecords.find((category) => category.slug === 'hardware-devices');
  const hrOpsCategory = categoryRecords.find((category) => category.slug === 'hr-ops');

  const seedTickets: {
    subject: string;
    description: string;
    priority: TicketPriority;
    status: TicketStatus;
    channel: TicketChannel;
    requesterId: string;
    assignedTeamId: string | null;
    assigneeId?: string | null;
    categoryId?: string | null;
    createdAt: Date;
    messages: { authorId: string; body: string; createdAt: Date }[];
    statusHistory?: { from: TicketStatus; to: TicketStatus; at: Date }[];
  }[] = [
    {
      subject: `${seedPrefix} VPN access for new contractor`,
      description: 'Need VPN access for contractor starting Monday. Please provision and confirm MFA setup.',
      priority: TicketPriority.P2,
      status: TicketStatus.IN_PROGRESS,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: itTeam.id,
      assigneeId: alex.id,
      categoryId: accessCategory?.id ?? null,
      createdAt: hoursAgo(120),
      messages: [
        { authorId: jane.id, body: 'Request submitted for VPN + MFA.', createdAt: hoursAgo(119) },
        { authorId: alex.id, body: 'Working on provisioning. Will confirm shortly.', createdAt: hoursAgo(96) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(118) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(110) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, at: hoursAgo(100) }
      ]
    },
    {
      subject: `${seedPrefix} Update AI model access policy`,
      description: 'Review and update the approval workflow for external model usage.',
      priority: TicketPriority.P3,
      status: TicketStatus.WAITING_ON_VENDOR,
      channel: TicketChannel.PORTAL,
      requesterId: sam.id,
      assignedTeamId: aiTeam.id,
      assigneeId: sam.id,
      categoryId: accessCategory?.id ?? null,
      createdAt: hoursAgo(90),
      messages: [
        { authorId: sam.id, body: 'Drafted policy updates, awaiting vendor response.', createdAt: hoursAgo(80) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(88) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(86) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, at: hoursAgo(82) },
        { from: TicketStatus.IN_PROGRESS, to: TicketStatus.WAITING_ON_VENDOR, at: hoursAgo(78) }
      ]
    },
    {
      subject: `${seedPrefix} Medicaid pending claim follow-up`,
      description: 'Claim #MP-44821 requires an eligibility verification update.',
      priority: TicketPriority.P1,
      status: TicketStatus.ASSIGNED,
      channel: TicketChannel.EMAIL,
      requesterId: jane.id,
      assignedTeamId: medicaidTeam.id,
      assigneeId: null,
      categoryId: accessCategory?.id ?? null,
      createdAt: hoursAgo(72),
      messages: [
        { authorId: jane.id, body: 'Need confirmation on eligibility verification for claim.', createdAt: hoursAgo(71) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(70) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(68) }
      ]
    },
    {
      subject: `${seedPrefix} Executive laptop replacement`,
      description: 'White glove request: replace executive laptop before travel.',
      priority: TicketPriority.P2,
      status: TicketStatus.NEW,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: vipTeam.id,
      assigneeId: null,
      categoryId: hardwareCategory?.id ?? null,
      createdAt: hoursAgo(24),
      messages: [
        { authorId: jane.id, body: 'Executive laptop needs replacement before travel.', createdAt: hoursAgo(23) }
      ]
    },
    {
      subject: `${seedPrefix} Onboarding access checklist`,
      description: 'New hire onboarding checklist requires approvals.',
      priority: TicketPriority.P3,
      status: TicketStatus.TRIAGED,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: hrTeam.id,
      assigneeId: null,
      categoryId: hrOpsCategory?.id ?? null,
      createdAt: hoursAgo(40),
      messages: [
        { authorId: jane.id, body: 'Submitted onboarding checklist for approvals.', createdAt: hoursAgo(39) }
      ],
      statusHistory: [{ from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(38) }]
    },
    {
      subject: `${seedPrefix} Payroll access revocation`,
      description: 'Please revoke payroll access for departing contractor.',
      priority: TicketPriority.P4,
      status: TicketStatus.WAITING_ON_REQUESTER,
      channel: TicketChannel.EMAIL,
      requesterId: jane.id,
      assignedTeamId: hrTeam.id,
      assigneeId: maria.id,
      categoryId: hrOpsCategory?.id ?? null,
      createdAt: hoursAgo(60),
      messages: [
        { authorId: jane.id, body: 'Revocation request for contractor.', createdAt: hoursAgo(59) },
        { authorId: maria.id, body: 'Need contractor end date to proceed.', createdAt: hoursAgo(55) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(58) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(57) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.WAITING_ON_REQUESTER, at: hoursAgo(54) }
      ]
    },
    {
      subject: `${seedPrefix} Wireless headset procurement`,
      description: 'Requesting a new wireless headset for support calls.',
      priority: TicketPriority.P4,
      status: TicketStatus.RESOLVED,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: itTeam.id,
      assigneeId: alex.id,
      categoryId: hardwareCategory?.id ?? null,
      createdAt: hoursAgo(96),
      messages: [
        { authorId: jane.id, body: 'Need headset for remote support calls.', createdAt: hoursAgo(95) },
        { authorId: alex.id, body: 'Ordered headset and updated ticket.', createdAt: hoursAgo(30) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(92) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(90) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, at: hoursAgo(80) },
        { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, at: hoursAgo(28) }
      ]
    },
    {
      subject: `${seedPrefix} VPN access — re-opened`,
      description: 'VPN access issue resurfaced after resolution.',
      priority: TicketPriority.P2,
      status: TicketStatus.REOPENED,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: itTeam.id,
      assigneeId: alex.id,
      categoryId: accessCategory?.id ?? null,
      createdAt: hoursAgo(140),
      messages: [
        { authorId: jane.id, body: 'VPN issue fixed but resurfaced today.', createdAt: hoursAgo(5) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(138) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(136) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, at: hoursAgo(130) },
        { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, at: hoursAgo(20) },
        { from: TicketStatus.RESOLVED, to: TicketStatus.REOPENED, at: hoursAgo(4) }
      ]
    },
    {
      subject: `${seedPrefix} Account deprovisioning completed`,
      description: 'Completed account deprovisioning for contractor.',
      priority: TicketPriority.P3,
      status: TicketStatus.CLOSED,
      channel: TicketChannel.EMAIL,
      requesterId: jane.id,
      assignedTeamId: itTeam.id,
      assigneeId: alex.id,
      categoryId: accessCategory?.id ?? null,
      createdAt: hoursAgo(200),
      messages: [
        { authorId: jane.id, body: 'Please deprovision account by end of day.', createdAt: hoursAgo(199) },
        { authorId: alex.id, body: 'Completed and verified. Closing ticket.', createdAt: hoursAgo(10) }
      ],
      statusHistory: [
        { from: TicketStatus.NEW, to: TicketStatus.TRIAGED, at: hoursAgo(198) },
        { from: TicketStatus.TRIAGED, to: TicketStatus.ASSIGNED, at: hoursAgo(195) },
        { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, at: hoursAgo(180) },
        { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, at: hoursAgo(12) },
        { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, at: hoursAgo(8) }
      ]
    },
    {
      subject: `${seedPrefix} Unassigned intake for triage`,
      description: 'Unassigned intake ticket pending triage.',
      priority: TicketPriority.P3,
      status: TicketStatus.NEW,
      channel: TicketChannel.PORTAL,
      requesterId: jane.id,
      assignedTeamId: null,
      assigneeId: null,
      categoryId: null,
      createdAt: hoursAgo(12),
      messages: [
        { authorId: jane.id, body: 'Submitted ticket awaiting triage.', createdAt: hoursAgo(11) }
      ]
    }
  ];

  for (const ticket of seedTickets) {
    const statusHistory = ticket.statusHistory ?? [];
    const historyDates = statusHistory.map((entry) => entry.at);
    const messageDates = ticket.messages.map((message) => message.createdAt);
    const lastActivity = new Date(
      Math.max(ticket.createdAt.getTime(), ...historyDates.map((d) => d.getTime()), ...messageDates.map((d) => d.getTime()))
    );

    const resolvedEvent = statusHistory.find((entry) => entry.to === TicketStatus.RESOLVED);
    const closedEvent = statusHistory.find((entry) => entry.to === TicketStatus.CLOSED);
    const completedEvent = closedEvent ?? resolvedEvent;

    const createdTicket = await prisma.ticket.create({
      data: {
        subject: ticket.subject,
        description: ticket.description,
        priority: ticket.priority,
        status: ticket.status,
        channel: ticket.channel,
        requesterId: ticket.requesterId,
        assignedTeamId: ticket.assignedTeamId,
        assigneeId: ticket.assigneeId ?? null,
        categoryId: ticket.categoryId ?? null,
        createdAt: ticket.createdAt,
        updatedAt: lastActivity,
        resolvedAt: resolvedEvent?.at ?? null,
        closedAt: closedEvent?.at ?? null,
        completedAt: completedEvent?.at ?? null
      }
    });
    const displayId = buildDisplayId(
      ticket.assignedTeamId ? (teamNameById.get(ticket.assignedTeamId) ?? null) : null,
      createdTicket.createdAt,
      createdTicket.number
    );
    await prisma.ticket.update({
      where: { id: createdTicket.id },
      data: { displayId }
    });

    await prisma.ticketEvent.create({
      data: {
        ticketId: createdTicket.id,
        type: 'TICKET_CREATED',
        payload: { subject: ticket.subject, priority: ticket.priority },
        createdAt: ticket.createdAt,
        createdById: ticket.requesterId
      }
    });

    if (statusHistory.length > 0) {
      await prisma.ticketEvent.createMany({
        data: statusHistory.map((entry) => ({
          ticketId: createdTicket.id,
          type: 'TICKET_STATUS_CHANGED',
          payload: { from: entry.from, to: entry.to },
          createdAt: entry.at,
          createdById: ticket.assigneeId ?? ticket.requesterId
        }))
      });
    }

    await prisma.ticketMessage.createMany({
      data: ticket.messages.map((message) => ({
        ticketId: createdTicket.id,
        authorId: message.authorId,
        type: MessageType.PUBLIC,
        body: message.body,
        createdAt: message.createdAt
      }))
    });
  }
}

async function seedTest() {
  const ids = {
    teamIt: '11111111-1111-4111-8111-111111111111',
    teamHr: '22222222-2222-4222-8222-222222222222',
    requester: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    otherRequester: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    agent: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lead: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    admin: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    owner: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo'
  };

  await prisma.ticketAccess.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();
  await prisma.category.deleteMany();

  await prisma.team.createMany({
    data: [
      { id: ids.teamIt, name: 'IT Service Desk', slug: 'it-service-desk', description: 'IT ops' },
      { id: ids.teamHr, name: 'HR Operations', slug: 'hr-operations', description: 'HR ops' }
    ]
  });
  const teamNameById = new Map<string, string>([
    [ids.teamIt, 'IT Service Desk'],
    [ids.teamHr, 'HR Operations']
  ]);

  await prisma.category.createMany({
    data: [
      { id: 'c1111111-1111-4111-8111-111111111111', name: 'Access & Identity', slug: 'access-identity' },
      { id: 'c2222222-2222-4222-8222-222222222222', name: 'Hardware & Devices', slug: 'hardware-devices' }
    ]
  });

  await prisma.user.createMany({
    data: [
      {
        id: ids.requester,
        email: 'requester@company.com',
        displayName: 'Requestor One',
        role: UserRole.EMPLOYEE,
        department: 'Finance',
        location: 'Remote'
      },
      {
        id: ids.otherRequester,
        email: 'other.requester@company.com',
        displayName: 'Requestor Two',
        role: UserRole.EMPLOYEE,
        department: 'HR',
        location: 'Remote'
      },
      {
        id: ids.agent,
        email: 'agent@company.com',
        displayName: 'Agent One',
        role: UserRole.AGENT,
        department: 'IT',
        location: 'Remote'
      },
      {
        id: ids.lead,
        email: 'lead@company.com',
        displayName: 'Lead One',
        role: UserRole.LEAD,
        department: 'IT',
        location: 'Remote'
      },
      {
        id: ids.admin,
        email: 'admin@company.com',
        displayName: 'Team Admin One',
        role: UserRole.TEAM_ADMIN,
        department: 'Security',
        location: 'Remote',
        primaryTeamId: ids.teamIt
      },
      {
        id: ids.owner,
        email: 'owner@company.com',
        displayName: 'Owner One',
        role: UserRole.OWNER,
        department: null,
        location: 'Remote'
      }
    ]
  });

  await prisma.teamMember.createMany({
    data: [
      { id: 'e1111111-1111-1111-1111-111111111111', teamId: ids.teamIt, userId: ids.agent, role: TeamRole.AGENT },
      { id: 'e2222222-2222-2222-2222-222222222222', teamId: ids.teamIt, userId: ids.lead, role: TeamRole.LEAD },
      { id: 'e3333333-3333-3333-3333-333333333333', teamId: ids.teamIt, userId: ids.admin, role: TeamRole.ADMIN }
    ]
  });

  await prisma.slaPolicy.createMany({
    data: [
      { teamId: ids.teamIt, priority: TicketPriority.P1, firstResponseHours: 1, resolutionHours: 4 },
      { teamId: ids.teamIt, priority: TicketPriority.P2, firstResponseHours: 4, resolutionHours: 24 },
      { teamId: ids.teamIt, priority: TicketPriority.P3, firstResponseHours: 8, resolutionHours: 72 },
      { teamId: ids.teamIt, priority: TicketPriority.P4, firstResponseHours: 24, resolutionHours: 168 },
      { teamId: ids.teamHr, priority: TicketPriority.P1, firstResponseHours: 2, resolutionHours: 8 },
      { teamId: ids.teamHr, priority: TicketPriority.P2, firstResponseHours: 6, resolutionHours: 32 },
      { teamId: ids.teamHr, priority: TicketPriority.P3, firstResponseHours: 12, resolutionHours: 96 },
      { teamId: ids.teamHr, priority: TicketPriority.P4, firstResponseHours: 24, resolutionHours: 168 }
    ]
  });

  const ticketAssigned = await prisma.ticket.create({
    data: {
      subject: 'VPN access request',
      description: 'Need VPN access for contractor',
      status: TicketStatus.ASSIGNED,
      priority: TicketPriority.P2,
      channel: TicketChannel.PORTAL,
      requesterId: ids.requester,
      assignedTeamId: ids.teamIt,
      assigneeId: ids.agent
    }
  });
  await prisma.ticket.update({
    where: { id: ticketAssigned.id },
    data: { displayId: buildDisplayId(teamNameById.get(ids.teamIt) ?? null, ticketAssigned.createdAt, ticketAssigned.number) }
  });

  const ticketUnassigned = await prisma.ticket.create({
    data: {
      subject: 'Laptop provisioning',
      description: 'Need a new laptop',
      status: TicketStatus.NEW,
      priority: TicketPriority.P3,
      channel: TicketChannel.PORTAL,
      requesterId: ids.requester,
      assignedTeamId: ids.teamIt
    }
  });
  await prisma.ticket.update({
    where: { id: ticketUnassigned.id },
    data: { displayId: buildDisplayId(teamNameById.get(ids.teamIt) ?? null, ticketUnassigned.createdAt, ticketUnassigned.number) }
  });

  const ticketHr = await prisma.ticket.create({
    data: {
      subject: 'HR onboarding',
      description: 'New hire onboarding package',
      status: TicketStatus.TRIAGED,
      priority: TicketPriority.P2,
      channel: TicketChannel.EMAIL,
      requesterId: ids.requester,
      assignedTeamId: ids.teamHr
    }
  });
  await prisma.ticket.update({
    where: { id: ticketHr.id },
    data: { displayId: buildDisplayId(teamNameById.get(ids.teamHr) ?? null, ticketHr.createdAt, ticketHr.number) }
  });

  const ticketBenefits = await prisma.ticket.create({
    data: {
      subject: 'Benefits update',
      description: 'Update medical coverage information.',
      status: TicketStatus.NEW,
      priority: TicketPriority.P3,
      channel: TicketChannel.PORTAL,
      requesterId: ids.otherRequester,
      assignedTeamId: ids.teamHr
    }
  });
  await prisma.ticket.update({
    where: { id: ticketBenefits.id },
    data: { displayId: buildDisplayId(teamNameById.get(ids.teamHr) ?? null, ticketBenefits.createdAt, ticketBenefits.number) }
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: ticketAssigned.id,
        authorId: ids.requester,
        type: MessageType.PUBLIC,
        body: 'Initial request.'
      },
      {
        ticketId: ticketUnassigned.id,
        authorId: ids.requester,
        type: MessageType.PUBLIC,
        body: 'Please provide a laptop.'
      }
    ]
  });

  await prisma.ticketEvent.createMany({
    data: [
      {
        ticketId: ticketAssigned.id,
        type: 'TICKET_CREATED',
        payload: { subject: ticketAssigned.subject }
      },
      {
        ticketId: ticketUnassigned.id,
        type: 'TICKET_CREATED',
        payload: { subject: ticketUnassigned.subject }
      }
    ]
  });

  await prisma.ticketAccess.create({
    data: {
      ticketId: ticketAssigned.id,
      teamId: ids.teamHr,
      accessLevel: AccessLevel.READ
    }
  });
}

async function seed() {
  if (process.env.SEED_MODE === 'minimal') {
    await seedMinimal();
    return;
  }
  if (process.env.SEED_MODE === 'test' || process.env.NODE_ENV === 'test') {
    await seedTest();
    return;
  }

  await seedDev();
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
