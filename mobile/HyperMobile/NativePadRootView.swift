import SwiftUI
import AuthenticationServices

private enum NavigationMode: String, Hashable {
    case recent
    case projects
}


struct NativePadRootView: View {
    @EnvironmentObject private var servers: ServerProfileStore
    @EnvironmentObject private var sessions: MultiServerSessionCoordinator
    @StateObject private var store = AgentListStore()
    @StateObject private var discovery = HyperMeshDiscovery.shared
    @StateObject private var mentionStore = MentionInboxStore()
    @State private var selection: AgentSummary?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var query = ""
    @State private var navigationMode = NavigationMode.recent
    @State private var expandedProjectIDs: Set<String> = []
    @State private var showingSettings = false
    @State private var showingServers = false
    @State private var showingNews = false
    @State private var showingHealth = false
    @State private var showingNewAgent = false
    @State private var newAgentProjectID = ""
    @State private var showingMentions = false
    @State private var mentionDestination: MentionChatDestination?
    @State private var needsLogin = false
    @State private var loginPassword = ""
    @State private var loginError: String?
    @State private var loggingIn = false
    @State private var sso = MobileSSO()
    @State private var showingLogoutConfirmation = false
    @State private var authUser: APIClient.AuthUser?

    private var baseURL: URL? { servers.selectedURL }
    private var selectedWorkspace: ServerWorkspaceSnapshot { sessions.workspace(for: servers.selectedID) }
    private var filtered: [AgentSummary] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return selectedWorkspace.agents.filter { agent in
            needle.isEmpty || agent.title.lowercased().contains(needle) || agent.id.lowercased().contains(needle) || agent.workspaceDir.lowercased().contains(needle)
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if ($0.unread > 0) != ($1.unread > 0) { return $0.unread > 0 }
            if $0.isRunning != $1.isRunning { return $0.isRunning }
            return $0.updatedAt > $1.updatedAt
        }
    }

    private var projectSections: [(id: String, title: String, agents: [AgentSummary])] {
        let grouped = Dictionary(grouping: filtered) { $0.projectId ?? "" }
        var sections = selectedWorkspace.projects.map { project in
            (id: project.id, title: project.title, agents: grouped[project.id] ?? [])
        }
        if !(grouped[""] ?? []).isEmpty || sections.isEmpty { sections.append((id: "", title: "Misc", agents: grouped[""] ?? [])) }
        return sections
    }



    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            VStack(spacing: 0) {
                Picker("Navigation", selection: $navigationMode) {
                    Text("Recent").tag(NavigationMode.recent)
                    Text("Projects").tag(NavigationMode.projects)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                List(selection: $selection) {
                    if navigationMode == .recent {
                        ForEach(filtered) { agent in
                            AgentRow(agent: agent).tag(agent)
                                .contextMenu { Button { pin(agent, !agent.pinned) } label: { Label(agent.pinned ? "Unpin" : "Pin", systemImage: "pin") } }
                        }
                    } else {
                        ForEach(projectSections, id: \.id) { section in
                            Section {
                                DisclosureGroup(isExpanded: Binding(
                                    get: { expandedProjectIDs.contains(section.id) },
                                    set: { expanded in
                                        if expanded { expandedProjectIDs.insert(section.id) }
                                        else { expandedProjectIDs.remove(section.id) }
                                    }
                                )) {
                                    Button {
                                        newAgentProjectID = section.id
                                        showingNewAgent = true
                                    } label: {
                                        Label("New agent", systemImage: "plus.circle")
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.tint)
                                    ForEach(section.agents) { agent in
                                        AgentRow(agent: agent).tag(agent)
                                            .contextMenu { Button { pin(agent, !agent.pinned) } label: { Label(agent.pinned ? "Unpin" : "Pin", systemImage: "pin") } }
                                    }
                                    if section.agents.isEmpty { Text("No chats").foregroundStyle(.secondary) }
                                } label: {
                                    HStack {
                                        Text(section.title).font(.headline)
                                        Spacer()
                                        Text("\(section.agents.count)").foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { await refreshSelected() }
            .navigationTitle("Chats")
            .searchable(text: $query, prompt: "Search chats")
            .overlay { if selectedWorkspace.isLoading && selectedWorkspace.agents.isEmpty { ProgressView("Connecting…") } }
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    ServerSwitcherMenu { showingServers = true }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    MentionInboxButton(unread: mentionStore.unread) { showingMentions = true }
                    Menu {
                        if let authUser { Text(authUser.name) }
                        Button("News", systemImage: "newspaper") { showingNews = true }
                        Button("Health Sync", systemImage: "heart.text.square") { showingHealth = true }
                        Divider()
                        Button("Manage servers", systemImage: "server.rack") { showingServers = true }
                        Button("Connection", systemImage: "gearshape") { showingSettings = true }
                        Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { showingLogoutConfirmation = true }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel("More")

                    Button { newAgentProjectID = ""; showingNewAgent = true } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("New chat")
                }
            }
        } detail: {
            if let destination = mentionDestination, let baseURL {
                NativeChatView(agent: destination.agent, baseURL: baseURL, profileID: servers.selectedID, targetMessageIdx: destination.messageIdx, onRead: { Task { await refreshSelected(); await mentionStore.load(baseURL: baseURL, showLoading: false) } }, onShowChats: { withAnimation(.snappy(duration: 0.2)) { columnVisibility = .all } })
                    .id(destination.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let agent = selection, let baseURL {
                NativeChatView(agent: agent, baseURL: baseURL, profileID: servers.selectedID, onRead: { Task { await refreshSelected() } }, onShowChats: { withAnimation(.snappy(duration: 0.2)) { columnVisibility = .all } })
                    .id(agent.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("Select a chat", systemImage: "bubble.left.and.bubble.right", description: Text("Choose a conversation from the chat list."))
                    .background(DotGridBackground())
            }
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(selection == nil ? .visible : .hidden, for: .navigationBar)
        .task { sessions.activate(profiles: servers.profiles, serverStore: servers); switchServer() }
        .task(id: servers.selectedID) { if let baseURL { await mentionStore.monitor(baseURL: baseURL) } }
        .onChange(of: servers.profiles) { _, profiles in sessions.activate(profiles: profiles, serverStore: servers) }
        .onChange(of: selectedWorkspace.agents) { _, agents in store.agents = agents }
        .onChange(of: selectedWorkspace.error) { _, error in store.error = error }
        .onChange(of: selection?.id) { _, value in
            MobileStateCache.shared.updateSelection(profileID: servers.selectedID, agentID: value)
            if value != mentionDestination?.agent.id { mentionDestination = nil }
            columnVisibility = value == nil ? .all : .detailOnly
        }
        .onChange(of: query) { _, value in MobileStateCache.shared.updateListState(profileID: servers.selectedID, folder: nil, query: value) }
        .onDisappear { store.stopRefreshing() }
        .onChange(of: servers.selectedID) { _, _ in
            needsLogin = false
            switchServer()
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(350))
                needsLogin = shouldRequireLogin
            }
        }
        .onChange(of: servers.auth(for: servers.selectedID).status) { _, _ in needsLogin = shouldRequireLogin }
        .sheet(isPresented: $showingMentions) { if let baseURL { MentionInboxView(store: mentionStore, baseURL: baseURL, select: openMention) } }

        .sheet(isPresented: $showingSettings) { ServerProfilesView() }
        .sheet(isPresented: $showingServers) { ServerProfilesView() }
        .sheet(isPresented: $showingHealth) { if let healthURL = servers.trustedHealthURL { HealthSyncView(baseURL: healthURL, serverName: servers.trustedHealthProfile.name) } }
        .fullScreenCover(isPresented: $showingNews) { if let baseURL { NativePadNewsView(baseURL: baseURL) } }
        .sheet(isPresented: $showingNewAgent) { if let baseURL { NewAgentView(baseURL: baseURL, initialProjectID: newAgentProjectID) { created in showingNewAgent = false; Task { await refreshSelected(); selection = store.agents.first { $0.id == created.id } } } } }
        .sheet(isPresented: $needsLogin) {
            NativeLoginView(password: $loginPassword, error: loginError, isLoading: loggingIn, sso: { signInWithSSO() }) { login() }
        }
        .confirmationDialog("Sign out of Hyper?", isPresented: $showingLogoutConfirmation, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { logout() }
            Button("Cancel", role: .cancel) { }
        }
    }


    private func openMention(_ mention: MobileMention) {
        guard let baseURL else { return }
        showingMentions = false
        Task {
            var agent = selectedWorkspace.agents.first { $0.id == mention.agentId }
            if agent == nil { agent = try? await APIClient(baseURL: baseURL).agent(id: mention.agentId).summary }
            guard let agent else { return }
            selection = agent
            mentionDestination = MentionChatDestination(mentionID: mention.id, agent: agent, messageIdx: mention.messageIdx)
            columnVisibility = .detailOnly
        }
    }


    private func refreshSelected() async {
        await sessions.refresh(profile: servers.selectedProfile, serverStore: servers)
        let snapshot = sessions.workspace(for: servers.selectedID)
        store.agents = snapshot.agents
        store.error = snapshot.error
        authUser = authUserFromSnapshot()
        needsLogin = shouldRequireLogin
    }
    private func login() { guard let baseURL, !loginPassword.isEmpty else { return }; loggingIn = true; Task { do { try await APIClient(baseURL: baseURL).login(password: loginPassword); loginPassword = ""; needsLogin = false; sessions.resume(profile: servers.selectedProfile, serverStore: servers); await refreshSelected() } catch { loginError = error.localizedDescription }; loggingIn = false } }
    private func signInWithSSO() { guard let baseURL else { return }; loggingIn = true; loginError = nil; Task { do { try await sso.signIn(baseURL: baseURL); needsLogin = false; sessions.resume(profile: servers.selectedProfile, serverStore: servers); await refreshSelected() } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { } catch { loginError = error.localizedDescription }; loggingIn = false } }
    private func logout() { guard let baseURL else { return }; let profileID = servers.selectedID; Task { do { try await APIClient(baseURL: baseURL).logout(); ServerSessionPool.shared.clear(baseURL: baseURL); servers.markSignedOut(profileID); sessions.remove(profileID: profileID); sessions.activate(profiles: servers.profiles, serverStore: servers); store.stopRefreshing(); store.agents = []; selection = nil; authUser = nil; loginPassword = ""; loginError = nil; needsLogin = true } catch { loginError = error.localizedDescription } } }
    private func switchServer() { store.stopRefreshing(); let cached = MobileStateCache.shared.server(servers.selectedID); let snapshot = sessions.workspace(for: servers.selectedID); selection = cached.selectedAgentID.flatMap { id in snapshot.agents.first { $0.id == id } }; query = cached.query; loginPassword = ""; loginError = nil; store.agents = snapshot.agents; store.error = snapshot.error; authUser = authUserFromSnapshot(); needsLogin = shouldRequireLogin; sessions.resume(profile: servers.selectedProfile, serverStore: servers, refreshImmediately: false); Task { await sessions.refresh(profile: servers.selectedProfile, serverStore: servers, showLoading: snapshot.agents.isEmpty) } }
    private var shouldRequireLogin: Bool {
        servers.auth(for: servers.selectedID).status == .signInRequired && discovery.reachability(for: baseURL) != .noAccess
    }

    private func authUserFromSnapshot() -> APIClient.AuthUser? { let auth = servers.auth(for: servers.selectedID); guard auth.status == .authenticated else { return nil }; return APIClient.AuthUser(id: auth.userID, name: auth.userName ?? "Signed in", email: auth.userEmail, role: auth.role ?? "user") }
    private func pin(_ agent: AgentSummary, _ value: Bool) { guard let baseURL else { return }; Task { await store.setPinned(agent, pinned: value, baseURL: baseURL); await refreshSelected() } }
}
