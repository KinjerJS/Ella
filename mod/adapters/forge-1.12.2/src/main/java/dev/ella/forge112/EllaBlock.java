package dev.ella.forge112;

import dev.ella.core.SlotSettings;
import net.minecraft.block.Block;
import net.minecraft.block.SoundType;
import net.minecraft.block.material.Material;
import net.minecraft.block.properties.PropertyDirection;
import net.minecraft.block.state.BlockStateContainer;
import net.minecraft.block.state.IBlockState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.util.BlockRenderLayer;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.Mirror;
import net.minecraft.util.Rotation;
import net.minecraft.util.math.AxisAlignedBB;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.IBlockAccess;
import net.minecraft.world.World;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

/**
 * A placeholder block whose behaviour comes from a {@link SlotSettings} object rather
 * than from constructor arguments.
 *
 * <p>This inversion is the whole trick. A stock block bakes hardness, render layer and
 * shape in at construction, so changing any of them means registering a new block — which
 * frozen registries forbid. Reading each property on demand means the launcher can change
 * them by writing to a field, and the next query picks it up.
 *
 * <p>The settings reference is captured once at registration and never replaced, which is
 * why {@link dev.ella.core.SlotPool} hands out stable objects.
 */
public class EllaBlock extends Block {

    /**
     * Stand-in used while {@link Block}'s constructor is still running.
     *
     * <p>{@code Block.<init>} builds its default block state, and that calls overridable
     * methods such as {@link #isOpaqueCube} <em>before</em> this class's fields are
     * assigned — so {@link #settings} is genuinely null for the duration of {@code super()}.
     * Reading it directly there throws, and the stack trace points at the override rather
     * than at the constructor that provoked it.
     *
     * <p>Shared and never mutated: it only ever supplies defaults during construction.
     */
    private static final SlotSettings DEFAULTS = new SlotSettings();

    private final SlotSettings settings;
    private final int slot;

    /**
     * Orientation, present on every slot.
     *
     * <p>State properties are baked into the {@link net.minecraft.block.state.BlockStateContainer}
     * at construction, exactly like registry entries are frozen after startup. A slot that
     * might later be made rotatable therefore has to carry the property from the start;
     * the {@code rotation} setting only decides whether placement uses it.
     */
    public static final PropertyDirection FACING = PropertyDirection.create("facing");

    public EllaBlock(SlotSettings settings, int slot) {
        // Material.ROCK is only a starting point; the properties that matter are all
        // overridden below to read from `settings`.
        super(Material.ROCK);
        this.settings = settings;
        this.slot = slot;

        setHardness(1.5f);
        setResistance(6.0f);
        setDefaultState(this.blockState.getBaseState().withProperty(FACING, EnumFacing.NORTH));
    }

    // --- state ---------------------------------------------------------------

    @Override
    protected BlockStateContainer createBlockState() {
        return new BlockStateContainer(this, FACING);
    }

    @Override
    public IBlockState getStateFromMeta(int meta) {
        // Six directions fit in three bits; anything else is a corrupt value, so fall
        // back to north rather than throwing during world load.
        EnumFacing facing = EnumFacing.byIndex(meta);
        return getDefaultState().withProperty(FACING, facing);
    }

    @Override
    public int getMetaFromState(IBlockState state) {
        return state.getValue(FACING).getIndex();
    }

    /**
     * Chooses the facing a newly placed block gets.
     *
     * <p>With rotation off this always returns north, so the block renders exactly as
     * authored — the property exists but is never varied.
     */
    @Override
    public IBlockState getStateForPlacement(World world, BlockPos pos, EnumFacing face,
                                            float hitX, float hitY, float hitZ, int meta,
                                            EntityLivingBase placer) {
        String mode = live().rotation;

        if ("horizontal".equals(mode)) {
            // Facing the player, which is what furnaces and chests do.
            return getDefaultState().withProperty(FACING, placer.getHorizontalFacing().getOpposite());
        }
        if ("all".equals(mode)) {
            // The face that was clicked, like observers and pistons.
            return getDefaultState().withProperty(FACING, face);
        }
        return getDefaultState().withProperty(FACING, EnumFacing.NORTH);
    }

    /** Keeps orientation correct when a structure block or command rotates the world. */
    @Override
    public IBlockState withRotation(IBlockState state, Rotation rotation) {
        return state.withProperty(FACING, rotation.rotate(state.getValue(FACING)));
    }

    @Override
    public IBlockState withMirror(IBlockState state, Mirror mirror) {
        // Goes through our own withRotation: IBlockState has no such method on 1.12.2.
        return withRotation(state, mirror.toRotation(state.getValue(FACING)));
    }

    /**
     * The live settings, or shared defaults while the superclass constructor is running.
     * Every override below goes through this rather than touching the field.
     */
    private SlotSettings live() {
        SlotSettings current = settings;
        return current != null ? current : DEFAULTS;
    }

    public int slot() {
        return slot;
    }

    public SlotSettings settings() {
        return settings;
    }

    // --- appearance ---------------------------------------------------------

    /**
     * MCP names this {@code getRenderLayer} on 1.12.2 — not {@code getBlockLayer}, which
     * is the name older tutorials use and an earlier MCP mapping exported.
     */
    @Override
    @SideOnly(Side.CLIENT)
    public BlockRenderLayer getRenderLayer() {
        String layer = live().renderLayer;
        if ("cutout".equals(layer)) return BlockRenderLayer.CUTOUT;
        if ("cutout_mipped".equals(layer)) return BlockRenderLayer.CUTOUT_MIPPED;
        if ("translucent".equals(layer)) return BlockRenderLayer.TRANSLUCENT;
        return BlockRenderLayer.SOLID;
    }

    /**
     * Controls whether neighbouring faces are culled. Returning false is what actually
     * makes a transparent block look transparent — the render layer alone is not enough,
     * which is the mistake the editor warns about.
     */
    @Override
    public boolean isOpaqueCube(IBlockState state) {
        return live().opaque;
    }

    @Override
    public boolean isFullCube(IBlockState state) {
        return live().fullCube;
    }

    @Override
    public boolean isFullBlock(IBlockState state) {
        return live().fullCube && live().opaque;
    }

    @Override
    public boolean causesSuffocation(IBlockState state) {
        return live().fullCube && live().opaque;
    }

    @Override
    public int getLightValue(IBlockState state, IBlockAccess world, BlockPos pos) {
        return live().lightLevel;
    }

    @Override
    public int getLightOpacity(IBlockState state) {
        // A non-opaque block must not block light, otherwise glass-like models render
        // with a black interior.
        return live().opaque ? 255 : 0;
    }

    // --- physical -----------------------------------------------------------

    @Override
    public float getBlockHardness(IBlockState state, World world, BlockPos pos) {
        return live().hardness;
    }

    @Override
    public float getExplosionResistance(World world, BlockPos pos, Entity exploder,
                                        net.minecraft.world.Explosion explosion) {
        // Minecraft stores resistance pre-divided by 5; the launcher exposes the value
        // players actually recognise, so convert here rather than in the editor.
        return live().resistance / 5.0f;
    }

    @Override
    public SoundType getSoundType(IBlockState state, World world, BlockPos pos, Entity entity) {
        return Sounds.byName(live().soundType);
    }

    // --- shape --------------------------------------------------------------

    @Override
    public AxisAlignedBB getBoundingBox(IBlockState state, IBlockAccess source, BlockPos pos) {
        if (!"custom".equals(live().collision)) return FULL_BLOCK_AABB;
        float[] box = live().hitboxNormalised();
        return new AxisAlignedBB(box[0], box[1], box[2], box[3], box[4], box[5]);
    }

    @Override
    public AxisAlignedBB getCollisionBoundingBox(IBlockState state, IBlockAccess world,
                                                 BlockPos pos) {
        if ("none".equals(live().collision)) return NULL_AABB;
        return getBoundingBox(state, world, pos);
    }

    @Override
    public boolean shouldSideBeRendered(IBlockState state, IBlockAccess world, BlockPos pos,
                                        net.minecraft.util.EnumFacing side) {
        // Let two adjacent non-opaque blocks of the same kind still draw their shared
        // faces; hiding them is only correct for full opaque cubes.
        if (!live().opaque || !live().fullCube) return true;
        return super.shouldSideBeRendered(state, world, pos, side);
    }
}
