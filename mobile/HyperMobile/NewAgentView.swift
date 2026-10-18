import SwiftUI

struct NewAgentView: View {
    let baseURL: URL
    let initialProjectID: String
    let created: (CreatedAgent) -> Void

    init(baseURL: URL, initialProjectID: String = "", created: @escaping (CreatedAgent) -> Void) {
        self.baseURL = baseURL
        self.initialProjectID = initialProjectID
        self.created = created
        _projectID = State(initialValue: initialProjectID)
    }
    @Environment(\.dismiss) private var dismiss
    @State private var options: NewAgentOptions?
    @State private var title = ""
    @State private var workspace = ""
    @State private var projectID = ""
    @State private var model = ""
    @State private var systemPrompt = ""
    @State private var provider = ""
    @State private var loading = false
    @State private var error: String?
    @State private var showingWorkspacePicker = false
    @State private var showingProviderPicker = false
    @State private var showingModelPicker = false
    @State private var showingProjectCreator = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    TextField("Name (optional)", text: $title)
                    Button { showingProviderPicker = true } label: {
                        selectionRow(title: "Provider", value: provider.isEmpty ? "Choose provider" : provider)
                    }
                    .disabled(providers.isEmpty)
                    Button { showingModelPicker = true } label: {
                        selectionRow(title: "Model", value: model.isEmpty ? "Choose model" : modelLabel(model))
                    }
                    .disabled(provider.isEmpty || modelsForProvider.isEmpty)
                }
                Section("Project") {
                    Picker("Project", selection: $projectID) {
                        Text("Misc").tag("")
                        ForEach(options?.projects ?? []) { project in
                            Text(project.title).tag(project.id)
                        }
                    }
                    Button { showingProjectCreator = true } label: { Label("New project", systemImage: "folder.badge.plus") }
                }

                Section("Workspace") {
                    if let project = selectedProject {
                        LabeledContent("Inherited from", value: project.defaultDir ?? "Project workspace")
                            .foregroundStyle(.secondary)
                        TextField("Override with full path (optional)", text: $workspace).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } else {
                        Button { showingWorkspacePicker = true } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Folder").font(.caption).foregroundStyle(.secondary)
                                    Text(workspaceLabel).foregroundStyle(.primary).lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                            }.contentShape(Rectangle())
                        }
                        TextField("Or enter full path", text: $workspace).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                Section("Instructions") {
                    TextField("Optional system instructions", text: $systemPrompt, axis: .vertical).lineLimit(3...8)
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.caption) } }
            }
            .navigationTitle("New agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.fontWeight(.semibold).disabled(loading || options == nil)
                }
            }
            .overlay { if loading { ProgressView().padding(18).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14)) } }
        }
        .fullScreenCover(isPresented: $showingWorkspacePicker) {
            WorkspacePickerView(workspaces: options?.workspaces ?? [], selection: $workspace)
        }
        .sheet(isPresented: $showingProviderPicker) {
            ScrollableChoicePicker(title: "Choose provider", choices: providers, selection: $provider) { $0 }
        }
        .sheet(isPresented: $showingModelPicker) {
            ScrollableChoicePicker(title: "Choose model", choices: modelsForProvider.map(\.model), selection: $model, label: modelLabel)
        }
        .sheet(isPresented: $showingProjectCreator) {
            NewProjectView(baseURL: baseURL) { project in
                if var value = options {
                    var projects = value.projects ?? []
                    projects.append(project)
                    projects.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
                    options = NewAgentOptions(version: value.version, defaultModel: value.defaultModel, models: value.models, workspaces: value.workspaces, projects: projects)
                }
                projectID = project.id
                workspace = ""
                showingProjectCreator = false
            }
        }
        .task { await loadOptions() }
        .onChange(of: provider) { _, newProvider in
            if !modelsForProvider.contains(where: { $0.model == model }) {
                model = (options?.models.first { $0.provider == newProvider })?.model ?? ""
            }
        }
        .onChange(of: projectID) { _, _ in workspace = "" }
    }

    private func selectionRow(title: String, value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer()
            Text(value).foregroundStyle(.secondary).lineLimit(1)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }


    private var selectedProject: MobileProject? { options?.projects?.first { $0.id == projectID } }


    private var workspaceLabel: String {
        guard !workspace.isEmpty else { return "Default workspace" }
        let label = URL(fileURLWithPath: workspace).lastPathComponent
        return label.isEmpty ? workspace : label
    }

    private var providers: [String] {
        Array(Set((options?.models ?? []).map(\.provider))).sorted()
    }

    private var modelsForProvider: [MobileModel] {
        (options?.models ?? []).filter { $0.provider == provider }
    }

    private func modelLabel(_ value: String) -> String {
        value.split(separator: ":", maxSplits: 1).last.map(String.init) ?? value
    }

    private func loadOptions() async {
        loading = true; defer { loading = false }
        do {
            let value = try await APIClient(baseURL: baseURL).newAgentOptions()
            options = value
            let defaultItem = value.models.first { $0.model == value.defaultModel } ?? value.models.first
            provider = defaultItem?.provider ?? ""
            model = defaultItem?.model ?? ""
            projectID = value.projects?.contains(where: { $0.id == initialProjectID }) == true ? initialProjectID : ""
            workspace = projectID.isEmpty ? value.workspaces.first ?? "" : ""
        } catch { self.error = error.localizedDescription }
    }

    private func create() {
        loading = true; error = nil
        Task {
            do {
                let agent = try await APIClient(baseURL: baseURL).createAgent(title: title, workspaceDir: workspace, projectId: projectID, model: model, systemPrompt: systemPrompt)
                created(agent)
            } catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}

private struct NewProjectView: View {
    let baseURL: URL
    let created: (MobileProject) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var slug = ""
    @State private var defaultDir = ""
    @State private var loading = false
    @State private var error: String?
    @State private var editedSlug = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    TextField("Name", text: $title)
                    TextField("Slug", text: $slug).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Folder", text: $defaultDir).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.caption) } }
            }
            .navigationTitle("New project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Create") { create() }.disabled(loading || title.isEmpty || slug.isEmpty || defaultDir.isEmpty) }
            }
            .overlay { if loading { ProgressView().padding(18).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14)) } }
            .onChange(of: title) { _, value in if !editedSlug { slug = makeSlug(value) } }
            .onChange(of: slug) { old, new in if new != makeSlug(title) && new != old { editedSlug = true } }
        }
    }

    private func makeSlug(_ value: String) -> String {
        let words = value.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        guard let first = words.first else { return "" }
        let joined = first.lowercased() + words.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined()
        let filtered = joined.filter { $0.isLetter || $0.isNumber }
        guard let firstCharacter = filtered.first, firstCharacter.isLetter else { return "" }
        return String(filtered.prefix(63))
    }

    private func create() {
        loading = true; error = nil
        Task {
            do { created(try await APIClient(baseURL: baseURL).createProject(slug: slug, title: title, defaultDir: defaultDir)) }
            catch { self.error = error.localizedDescription; loading = false }
        }
    }
}


private struct ScrollableChoicePicker: View {
    let title: String
    let choices: [String]
    @Binding var selection: String
    let label: (String) -> String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [String] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return needle.isEmpty ? choices : choices.filter { label($0).lowercased().contains(needle) || $0.lowercased().contains(needle) }
    }

    var body: some View {
        NavigationStack {
            List(filtered, id: \.self) { value in
                Button {
                    selection = value
                    dismiss()
                } label: {
                    HStack {
                        Text(label(value)).foregroundStyle(.primary).lineLimit(2)
                        Spacer()
                        if value == selection { Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint) }
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .listStyle(.insetGrouped)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}


private struct WorkspacePickerView: View {
    let workspaces: [String]
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [String] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.isEmpty ? workspaces : workspaces.filter { $0.lowercased().contains(value) }
    }

    var body: some View {
        NavigationStack {
            List {
                Button { choose("") } label: { row(title: "Default workspace", path: nil, selected: selection.isEmpty) }
                ForEach(filtered, id: \.self) { path in
                    Button { choose(path) } label: { row(title: URL(fileURLWithPath: path).lastPathComponent, path: path, selected: selection == path) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Choose folder")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $query, prompt: "Search folders")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func choose(_ value: String) { selection = value; dismiss() }
    private func row(title: String, path: String?, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: path == nil ? "house" : "folder").foregroundStyle(.tint).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title.isEmpty ? "Folder" : title).foregroundStyle(.primary)
                if let path { Text(path).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            if selected { Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint) }
        }.contentShape(Rectangle()).padding(.vertical, 3)
    }
}
