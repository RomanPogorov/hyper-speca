import SwiftUI

struct MentionAvatar: View {
    let person: MentionPerson

    var body: some View {
        Group {
            if let picture = person.picture, let url = URL(string: picture), url.scheme == "https" {
                AuthenticatedRemoteImage(url: url) { image, _ in
                    if let image { Image(uiImage: image).resizable().scaledToFill() }
                    else { fallback }
                }
            } else {
                fallback
            }
        }
        .frame(width: 30, height: 30)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        Text(String((person.name.isEmpty ? person.id : person.name).prefix(1)).uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.accentColor.gradient)
    }
}


struct MentionChatDestination: Identifiable, Hashable {
    let mentionID: Int
    let agent: AgentSummary
    let messageIdx: Int
    var id: String { "\(mentionID)-\(agent.id)-\(messageIdx)" }
}

@MainActor
final class MentionInboxStore: ObservableObject {
    @Published private(set) var mentions: [MobileMention] = []
    @Published private(set) var unread = 0
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    func monitor(baseURL: URL) async {
        while !Task.isCancelled {
            await load(baseURL: baseURL, showLoading: mentions.isEmpty)
            try? await Task.sleep(for: .seconds(5))
        }
    }

    func load(baseURL: URL, showLoading: Bool = true) async {
        if showLoading { isLoading = true }
        defer { if showLoading { isLoading = false } }
        do {
            let response = try await APIClient(baseURL: baseURL).mentions(unreadOnly: true, limit: 100)
            mentions = response.mentions
            unread = response.unread
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func markRead(_ mention: MobileMention, baseURL: URL) async {
        mentions.removeAll { $0.id == mention.id }
        unread = max(0, unread - (mention.readAt == nil ? 1 : 0))
        do {
            let response = try await APIClient(baseURL: baseURL).markMentionRead(id: mention.id)
            unread = response.unread
        } catch {
            await load(baseURL: baseURL, showLoading: false)
        }
    }
}

struct MentionInboxButton: View {
    let unread: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "at")
                if unread > 0 {
                    Text(unread > 99 ? "99+" : String(unread))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(.orange, in: Capsule())
                        .offset(x: 9, y: -8)
                }
            }
        }
        .accessibilityLabel(unread > 0 ? "\(unread) unread mentions" : "Mentions")
    }
}

struct MentionInboxView: View {
    @ObservedObject var store: MentionInboxStore
    let baseURL: URL
    let select: (MobileMention) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.isLoading && store.mentions.isEmpty {
                    ProgressView("Loading mentions…")
                } else if let error = store.error, store.mentions.isEmpty {
                    ContentUnavailableView("Can’t load mentions", systemImage: "at.badge.exclamationmark", description: Text(error))
                } else if store.mentions.isEmpty {
                    ContentUnavailableView("No unread mentions", systemImage: "at", description: Text("New @mentions will appear here."))
                } else {
                    List(store.mentions) { mention in
                        Button {
                            select(mention)
                            Task { await store.markRead(mention, baseURL: baseURL) }
                        } label: {
                            MentionInboxRow(mention: mention)
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                    .refreshable { await store.load(baseURL: baseURL) }
                }
            }
            .navigationTitle("Mentions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await store.load(baseURL: baseURL, showLoading: store.mentions.isEmpty) }
        }
    }
}

private struct MentionInboxRow: View {
    let mention: MobileMention

    private var date: Date {
        Date(timeIntervalSince1970: mention.createdAt > 10_000_000_000 ? mention.createdAt / 1000 : mention.createdAt)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            ZStack {
                Circle().fill(.orange.gradient).frame(width: 36, height: 36)
                Text(mention.author?.initials ?? "@").font(.caption.bold()).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(mention.author?.name ?? mention.from ?? "Mention").font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer()
                    Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary)
                }
                Text(mention.agentTitle ?? mention.agentId).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(mention.excerpt).font(.subheadline).foregroundStyle(.primary).lineLimit(3)
            }
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}
